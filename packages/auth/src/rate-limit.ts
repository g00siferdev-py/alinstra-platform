import { log } from "@alinstra/config";
import { RATE_LIMITS, RETELL_MAX_BODY_BYTES, type RateLimitRule } from "./constants";
import { getCounter, resetMemoryCounter } from "./counter";
import { clientIp, normalizeEmail } from "./lockout";

/**
 * Phase S part 5 / S.1 rate limits. Fixed windows counted through `getCounter()` (Redis in production,
 * memory in tests). This module imports no database or Better Auth code, so route handlers and their
 * tests can use it on its own via `@alinstra/auth/rate-limit`.
 *
 * Subjects can be emails or IPs, so they only ever appear in counter keys, never in logs.
 */

export { RATE_LIMITS, RETELL_MAX_BODY_BYTES, resetMemoryCounter, clientIp };
export type { RateLimitRule };

export type RateLimitDecision = { limited: false } | { limited: true; retryAfterSeconds: number };

const ALLOWED: RateLimitDecision = { limited: false };

/** The Redis client queues commands forever while disconnected, so a dead store would hang the request. */
const STORE_TIMEOUT_MS = 1500;

async function withTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("rate limit store timed out")), STORE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Counts one hit against `name:subject`. Every call counts, including calls that end up refused, so a
 * client that keeps hammering stays limited until its window expires.
 *
 * If the counter store is down this fails open and logs the limiter name only. These limits are abuse
 * brakes; losing Redis must not take down call handling, playback or sign-in on top of it.
 */
export async function consumeRateLimit(name: string, subject: string, rule: RateLimitRule): Promise<RateLimitDecision> {
  const key = `rl:${name}:${subject}`;
  try {
    return await withTimeout(async () => {
      const counter = getCounter();
      const count = await counter.increment(key, rule.windowSeconds);
      if (count <= rule.limit) return ALLOWED;
      const ttl = await counter.ttl(key);
      return { limited: true, retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds } as const;
    });
  } catch (error) {
    log("warn", "rate_limit.store_unavailable", { limiter: name, error: error instanceof Error ? error.name : "unknown" });
    return ALLOWED;
  }
}

/** Counts every check, then reports the longest wait among those that tripped. */
export async function consumeAllRateLimits(checks: Array<Promise<RateLimitDecision>>): Promise<RateLimitDecision> {
  const decisions = await Promise.all(checks);
  let retryAfterSeconds = 0;
  for (const decision of decisions) {
    if (decision.limited) retryAfterSeconds = Math.max(retryAfterSeconds, decision.retryAfterSeconds);
  }
  return retryAfterSeconds > 0 ? { limited: true, retryAfterSeconds } : ALLOWED;
}

export function retryAfterText(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

/** 429 with `Retry-After`. The body carries no detail about what was limited. */
export function rateLimitedResponse(retryAfterSeconds: number, message = "Too many requests. Try again later."): Response {
  return Response.json(
    { message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))), "cache-control": "private, no-store" } },
  );
}

/**
 * Reads the Retell raw body with a 1 MB cap. Check `Content-Length` first when present, then the
 * decoded length, so unsigned floods cannot force us to hash huge bodies.
 */
export async function readRetellRawBody(request: Request): Promise<string | Response> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared !== "") {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > RETELL_MAX_BODY_BYTES) {
      return new Response("Payload Too Large", { status: 413 });
    }
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > RETELL_MAX_BODY_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }
  return raw;
}

/**
 * Counts one bad-signature hit for `/api/retell/*`. Call only after signature verification fails.
 * Returns 429 with Retry-After once the IP is over the limit; otherwise 401.
 */
export async function retellBadSignatureResponse(request: Request): Promise<Response> {
  const decision = await consumeRateLimit("retell-bad-sig", clientIp(request), RATE_LIMITS.retellBadSignaturePerIp);
  if (decision.limited) return rateLimitedResponse(decision.retryAfterSeconds);
  return new Response("Unauthorized", { status: 401 });
}

/** Password reset requests: 5/hour per email and 20/hour per IP. Both counters always advance. */
export function consumePasswordResetHourly(email: string, ip: string): Promise<RateLimitDecision> {
  return consumeAllRateLimits([
    consumeRateLimit("reset-email", normalizeEmail(email), RATE_LIMITS.passwordResetPerEmail),
    consumeRateLimit("reset-ip", ip, RATE_LIMITS.passwordResetPerIp),
  ]);
}

/** Invite send and resend: 10/hour per client. */
export function consumeInviteLimit(clientId: string): Promise<RateLimitDecision> {
  return consumeRateLimit("invite", clientId, RATE_LIMITS.invitePerClient);
}

/** Owner quick updates and change requests share one bucket: 30/hour per user. */
export function consumeOwnerEditLimit(userId: string): Promise<RateLimitDecision> {
  return consumeRateLimit("owner-edit", userId, RATE_LIMITS.ownerEditPerUser);
}

/** Recording route: 120 per 10 minutes per user. Range requests count like any other. */
export async function recordingRateLimitResponse(userId: string): Promise<Response | null> {
  const decision = await consumeRateLimit("recording", userId, RATE_LIMITS.recordingPerUser);
  return decision.limited ? rateLimitedResponse(decision.retryAfterSeconds) : null;
}

/** Knowledge document download: 60 per 10 minutes per user. */
export async function documentDownloadRateLimitResponse(userId: string): Promise<Response | null> {
  const decision = await consumeRateLimit("document-download", userId, RATE_LIMITS.documentDownloadPerUser);
  return decision.limited ? rateLimitedResponse(decision.retryAfterSeconds) : null;
}
