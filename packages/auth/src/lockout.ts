import { getCounter } from "./counter";
import { LOGIN_LOCKOUT, PASSWORD_RESET_LIMIT } from "./constants";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}

function loginKey(email: string, ip: string): string {
  return `lockout:login:${normalizeEmail(email)}:${ip}`;
}

function resetKey(email: string): string {
  return `lockout:reset:${normalizeEmail(email)}`;
}

export async function loginLocked(email: string, ip: string): Promise<boolean> {
  const count = await getCounter().get(loginKey(email, ip));
  return count >= LOGIN_LOCKOUT.maxFailures;
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  await getCounter().increment(loginKey(email, ip), LOGIN_LOCKOUT.windowSeconds);
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await getCounter().clear(loginKey(email, ip));
}

export async function passwordResetLimited(email: string): Promise<boolean> {
  const count = await getCounter().get(resetKey(email));
  return count >= PASSWORD_RESET_LIMIT.maxRequests;
}

export async function recordPasswordResetRequest(email: string): Promise<void> {
  await getCounter().increment(resetKey(email), PASSWORD_RESET_LIMIT.windowSeconds);
}
