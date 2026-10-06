import { log } from "@alinstra/config";
import {
  describeBrowser,
  ipPrefixOf,
  maskIpPrefix,
  normalizeLoginEmail,
  prisma,
  recordLoginEvent,
  type LoginEventInput,
  type LoginEventResult,
} from "@alinstra/db";
import { enqueueSendAdminNotice, enqueueSignInNotice, type SendAdminNotice, type SendSignInNotice } from "@alinstra/queue";
import { getCounter, type Counter } from "./counter";
import { loginLocked } from "./lockout";

/**
 * Security alerts for sign-ins (Phase S part 3). Everything here is best-effort and goes through the queue:
 * a database, Redis, or mail failure is logged (error name only) and never changes the sign-in response.
 */

/** One admin-lockout notice per account per hour. */
export const ADMIN_LOCKOUT_ALERT_WINDOW_SECONDS = 3600;

export type SignInUser = { id: string; role: string; clientId: string | null } | null;

export type SignInAttempt = {
  user: SignInUser;
  email: string;
  success: boolean;
  ip: string;
  userAgent: string | null;
  /** Set by the caller when a failed attempt may have just tripped the lockout. */
  checkLockout?: boolean;
};

export type AlertDeps = {
  record: (input: LoginEventInput) => Promise<LoginEventResult>;
  adminNotice: (notice: SendAdminNotice) => Promise<void>;
  ownerNotice: (notice: SendSignInNotice) => Promise<void>;
  locked: (email: string, ip: string) => Promise<boolean>;
  counter: () => Counter;
  clientTimezone: (clientId: string) => Promise<string | undefined>;
  now: () => Date;
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export const defaultAlertDeps: AlertDeps = {
  record: (input) => recordLoginEvent(input, { onError: (error) => log("error", "login event write failed", { error: errorName(error) }) }),
  adminNotice: enqueueSendAdminNotice,
  ownerNotice: enqueueSignInNotice,
  locked: loginLocked,
  counter: getCounter,
  clientTimezone: async (clientId) => (await prisma.client.findUnique({ where: { id: clientId }, select: { timezone: true } }))?.timezone,
  now: () => new Date(),
};

async function alertNewNetwork(attempt: SignInAttempt, result: LoginEventResult, deps: AlertDeps): Promise<void> {
  const user = attempt.user;
  if (!user) return;
  const browser = describeBrowser(attempt.userAgent);
  const maskedNetwork = maskIpPrefix(result.ipPrefix);
  const at = deps.now();
  if (user.role === "admin") {
    await deps.adminNotice({
      subject: "Admin sign-in from a new network",
      text: [
        `An admin account (${normalizeLoginEmail(attempt.email)}) signed in from a network not seen in the last 90 days.`,
        "",
        `When: ${at.toISOString()}`,
        `Browser: ${browser}`,
        `Network: ${maskedNetwork}`,
        "",
        "If this was not you, reset the password and revoke the account's sessions.",
      ].join("\n"),
    });
    return;
  }
  if (user.role === "client_owner") {
    const timezone = user.clientId ? await deps.clientTimezone(user.clientId).catch(() => undefined) : undefined;
    await deps.ownerNotice({
      to: normalizeLoginEmail(attempt.email),
      at: at.toISOString(),
      browser,
      maskedNetwork,
      ...(timezone ? { timezone } : {}),
    });
  }
}

async function alertAdminLockout(attempt: SignInAttempt, deps: AlertDeps): Promise<void> {
  const user = attempt.user;
  if (!user || user.role !== "admin") return;
  if (!(await deps.locked(attempt.email, attempt.ip))) return;
  const first = (await deps.counter().increment(`alert:admin-lockout:${user.id}`, ADMIN_LOCKOUT_ALERT_WINDOW_SECONDS)) === 1;
  if (!first) return;
  await deps.adminNotice({
    subject: "Admin account locked after failed sign-ins",
    text: [
      `The admin account ${normalizeLoginEmail(attempt.email)} hit the sign-in lockout after repeated failed attempts.`,
      "",
      `When: ${deps.now().toISOString()}`,
      `Browser: ${describeBrowser(attempt.userAgent)}`,
      `Network: ${maskIpPrefix(ipPrefixOf(attempt.ip))}`,
      "",
      "If this was not you, someone is guessing the password. The lockout expires on its own.",
    ].join("\n"),
  });
}

/**
 * Logs one sign-in attempt and sends any alert it earns. Never throws and never waits on mail: alerts are only
 * enqueued. Safe to await from the auth handler.
 */
export async function trackSignIn(attempt: SignInAttempt, deps: AlertDeps = defaultAlertDeps): Promise<void> {
  let result: LoginEventResult = { written: false, newNetwork: false, ipPrefix: null };
  try {
    result = await deps.record({
      userId: attempt.user?.id ?? null,
      email: attempt.email,
      success: attempt.success,
      ip: attempt.ip,
      userAgent: attempt.userAgent,
    });
  } catch (error) {
    log("error", "login event write failed", { error: errorName(error) });
  }

  if (attempt.success && result.newNetwork) {
    try {
      await alertNewNetwork(attempt, result, deps);
    } catch (error) {
      log("error", "new sign-in alert failed to queue", { error: errorName(error) });
    }
  }

  if (!attempt.success && attempt.checkLockout) {
    try {
      await alertAdminLockout(attempt, deps);
    } catch (error) {
      log("error", "admin lockout alert failed to queue", { error: errorName(error) });
    }
  }
}
