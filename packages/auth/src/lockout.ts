import { getEnv } from "@alinstra/config";
import { getCounter } from "./counter";
import { ACCOUNT_LOGIN_LOCKOUT, LOGIN_LOCKOUT, PASSWORD_RESET_LIMIT } from "./constants";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function forwardedParts(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Client address for lockout.
 *
 * Railway's public specs set `X-Real-IP` to the connecting client and overwrite
 * a visitor-supplied value, so that header wins when present.
 * Otherwise walk `X-Forwarded-For` from the right, skipping `TRUSTED_PROXY_HOPS`
 * (default 1). The leftmost entry is attacker-controlled when a proxy appends.
 */
export function clientIp(request: Request, hops = getEnv().TRUSTED_PROXY_HOPS): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwardedParts(forwarded);
    if (parts.length > 0) {
      const index = parts.length - Math.max(hops, 0);
      return parts[index >= 0 ? index : 0] ?? "local";
    }
  }
  return "local";
}

function loginKey(email: string, ip: string): string {
  return `lockout:login:${normalizeEmail(email)}:${ip}`;
}

function accountLoginKey(email: string): string {
  return `lockout:login-account:${normalizeEmail(email)}`;
}

function resetKey(email: string): string {
  return `lockout:reset:${normalizeEmail(email)}`;
}

export async function loginLocked(email: string, ip: string): Promise<boolean> {
  const counter = getCounter();
  const [byIp, byAccount] = await Promise.all([
    counter.get(loginKey(email, ip)),
    counter.get(accountLoginKey(email)),
  ]);
  return byIp >= LOGIN_LOCKOUT.maxFailures || byAccount >= ACCOUNT_LOGIN_LOCKOUT.maxFailures;
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const counter = getCounter();
  await Promise.all([
    counter.increment(loginKey(email, ip), LOGIN_LOCKOUT.windowSeconds),
    counter.increment(accountLoginKey(email), ACCOUNT_LOGIN_LOCKOUT.windowSeconds),
  ]);
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const counter = getCounter();
  await Promise.all([counter.clear(loginKey(email, ip)), counter.clear(accountLoginKey(email))]);
}

export async function passwordResetLimited(email: string): Promise<boolean> {
  const count = await getCounter().get(resetKey(email));
  return count >= PASSWORD_RESET_LIMIT.maxRequests;
}

export async function recordPasswordResetRequest(email: string): Promise<void> {
  await getCounter().increment(resetKey(email), PASSWORD_RESET_LIMIT.windowSeconds);
}
