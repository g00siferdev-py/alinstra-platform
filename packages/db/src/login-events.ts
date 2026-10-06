import { prisma } from "./client";

/**
 * Sign-in attempt log (Phase S part 3). One row per attempt, written next to the lockout counters.
 * Holds a normalized email, the client IP and its network prefix, and a truncated user agent. Never a password.
 */

/** Rows older than this are deleted by the nightly purge. */
export const LOGIN_EVENT_RETENTION_DAYS = 180;
/** A successful sign-in from a prefix not seen for this long is "a new network". */
export const NEW_NETWORK_WINDOW_DAYS = 90;
const USER_AGENT_MAX = 200;
const IP_MAX = 64;
const DAY_MS = 86_400_000;

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/** Expands an IPv6 address to eight 16-bit groups, or null when it is not valid. */
function parseIpv6(value: string): number[] | null {
  const address = value.split("%")[0] ?? "";
  if (!address.includes(":")) return null;
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":").map((group) => (/^[0-9a-fA-F]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
    return groups.every((group) => !Number.isNaN(group)) ? groups : null;
  };
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...rest];
}

/**
 * Network prefix for an address: /24 for IPv4, /48 for IPv6 (IPv4-mapped IPv6 counts as IPv4).
 * Returns null for anything that is not an IP address (for example `local`).
 */
export function ipPrefixOf(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value) return null;
  const v4 = parseIpv4(value);
  if (v4) return `${v4[0]}.${v4[1]}.${v4[2]}.0/24`;
  const v6 = parseIpv6(value);
  if (!v6) return null;
  const mapped = v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff;
  if (mapped) return `${v6[6]! >> 8}.${v6[6]! & 255}.${v6[7]! >> 8}.0/24`;
  return `${v6[0]!.toString(16)}:${v6[1]!.toString(16)}:${v6[2]!.toString(16)}::/48`;
}

/** What goes in an email: the first two IPv4 octets or first two IPv6 groups only, e.g. `203.0.x.x`, `2001:db8:x`. */
export function maskIpPrefix(prefix: string | null | undefined): string {
  if (!prefix) return "unknown";
  const network = prefix.split("/")[0] ?? "";
  if (network.includes(":")) {
    const groups = network.split(":");
    return `${groups[0] || "0"}:${groups[1] || "0"}:x`;
  }
  const octets = network.split(".");
  if (octets.length !== 4) return "unknown";
  return `${octets[0]}.${octets[1]}.x.x`;
}

/** A short, human label such as "Chrome on Windows". No version numbers, no full user-agent string. */
export function describeBrowser(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "an unknown browser";
  let browser = "Unknown browser";
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return os ? `${browser} on ${os}` : browser;
}

export type LoginEventInput = {
  userId?: string | null;
  email: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

export type LoginEventResult = {
  written: boolean;
  /** Successful sign-in from a prefix the user has not signed in from in 90 days, and not their first sign-in. */
  newNetwork: boolean;
  ipPrefix: string | null;
};

/**
 * Writes one row. Never throws: a failed insert goes to `onError` (error name only) and the login carries on.
 * For a successful sign-in it first decides whether this is a new network. The very first successful
 * sign-in of a user never counts; neither does an address with no usable prefix.
 */
export async function recordLoginEvent(
  input: LoginEventInput,
  options: { now?: Date; onError?: (error: unknown) => void } = {},
): Promise<LoginEventResult> {
  const now = options.now ?? new Date();
  const email = normalizeLoginEmail(input.email);
  const ipPrefix = ipPrefixOf(input.ip);
  try {
    let newNetwork = false;
    if (input.success && input.userId && ipPrefix) {
      const since = new Date(now.getTime() - NEW_NETWORK_WINDOW_DAYS * DAY_MS);
      const [priorSuccess, seenRecently] = await Promise.all([
        prisma.loginEvent.findFirst({ where: { userId: input.userId, success: true }, select: { id: true } }),
        prisma.loginEvent.findFirst({ where: { userId: input.userId, success: true, ipPrefix, at: { gte: since } }, select: { id: true } }),
      ]);
      newNetwork = Boolean(priorSuccess) && !seenRecently;
    }
    await prisma.loginEvent.create({
      data: {
        userId: input.userId ?? null,
        email,
        at: now,
        success: input.success,
        ip: truncate(input.ip === "local" ? null : input.ip, IP_MAX),
        ipPrefix,
        userAgent: truncate(input.userAgent, USER_AGENT_MAX),
      },
    });
    return { written: true, newNetwork, ipPrefix };
  } catch (error) {
    try {
      options.onError?.(error);
    } catch {
      // Reporting must never break the sign-in.
    }
    return { written: false, newNetwork: false, ipPrefix };
  }
}

/** Deletes rows older than 180 days (exactly 180 days old is kept). Returns how many were removed. */
export async function purgeLoginEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOGIN_EVENT_RETENTION_DAYS * DAY_MS);
  const result = await prisma.loginEvent.deleteMany({ where: { at: { lt: cutoff } } });
  return result.count;
}

/** Bulk-read check: transcript views plus recording streams by one actor since `since`. */
export const BULK_READ_ACTIONS = ["call.transcript.view", "call.recording.stream"] as const;
export const BULK_READ_THRESHOLD = 50;
export const BULK_READ_WINDOW_MS = 10 * 60_000;

export async function countRecentBulkReads(actorUserId: string, now = new Date()): Promise<number> {
  return prisma.accessLog.count({
    where: { actorUserId, action: { in: [...BULK_READ_ACTIONS] }, at: { gte: new Date(now.getTime() - BULK_READ_WINDOW_MS) } },
  });
}
