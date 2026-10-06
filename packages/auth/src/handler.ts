import { auth } from "./auth";
import {
  clearLoginFailures,
  clientIp,
  loginLocked,
  normalizeEmail,
  passwordResetLimited,
  passwordResetRetryAfter,
  recordLoginFailure,
  recordPasswordResetRequest,
} from "./lockout";
import { consumePasswordResetHourly } from "./rate-limit";
import { ARCHIVED_CLIENT_MESSAGE, sessionBlockedForUser } from "./client-access";
import { prisma } from "@alinstra/db";
import { reenrollAdminTwoFactor, sessionRole } from "./two-factor-admin";
import { trackSignIn, type SignInUser } from "./security-alerts";

function authPath(request: Request): string {
  const { pathname } = new URL(request.url);
  const marker = "/api/auth";
  const index = pathname.indexOf(marker);
  if (index === -1) return pathname;
  return pathname.slice(index + marker.length) || "/";
}

function emailFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.clone().json()) as { email?: unknown };
      return emailFromUnknown(body.email);
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.clone().formData();
      return emailFromUnknown(form.get("email"));
    }
  } catch {
    return null;
  }
  return null;
}

/** Better Auth reads `x-real-ip`. Copy the request so Next's request object is not reused. */
export async function withTrustedClientIp(request: Request, ip: string): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-for");
  if (ip === "local") headers.delete("x-real-ip");
  else headers.set("x-real-ip", ip);
  if (request.method === "GET" || request.method === "HEAD") {
    return new Request(request.url, { method: request.method, headers });
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    body: await request.arrayBuffer(),
  });
}

async function findSignInUser(email: string): Promise<SignInUser> {
  try {
    return await prisma.user.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true, role: true, clientId: true } });
  } catch {
    return null;
  }
}

function tooMany(retryAfterSeconds?: number): Response {
  const headers = retryAfterSeconds ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) } : undefined;
  return Response.json({ message: "Too many attempts. Try again later." }, { status: 429, headers });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = authPath(request);
  const email = request.method === "POST" ? await readEmail(request) : null;
  const ip = clientIp(request);

  if (path === "/sign-in/email" && request.method === "POST" && !email) {
    return Response.json({ message: "Email is required." }, { status: 400 });
  }

  const signIn = path === "/sign-in/email" && request.method === "POST" && email ? email : null;
  const userAgent = request.headers.get("user-agent");
  let signInUser: SignInUser = null;

  if (signIn && (await loginLocked(signIn, ip))) {
    // The user is looked up so the event carries a userId; a lookup failure must not change the 429.
    signInUser = await findSignInUser(signIn);
    await trackSignIn({ user: signInUser, email: signIn, success: false, ip, userAgent });
    return tooMany();
  }

  if (signIn) {
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(signIn) },
      select: { id: true, role: true, clientId: true },
    });
    signInUser = user;
    if (user && (await sessionBlockedForUser(user.id))) {
      await trackSignIn({ user, email: signIn, success: false, ip, userAgent });
      return Response.json({ message: ARCHIVED_CLIENT_MESSAGE }, { status: 403 });
    }
  }

  if ((path === "/request-password-reset" || path === "/forget-password") && email) {
    if (await passwordResetLimited(email)) return tooMany(await passwordResetRetryAfter(email));
    // Phase S part 5: hourly caps per email (5) and per IP (20), on top of the short lockout key above.
    const hourly = await consumePasswordResetHourly(email, ip);
    if (hourly.limited) return tooMany(hourly.retryAfterSeconds);
    await recordPasswordResetRequest(email);
  }

  if (path === "/two-factor/disable" && request.method === "POST" && (await sessionRole(request)) === "admin") {
    return Response.json({ message: "Admins cannot turn off two-factor authentication." }, { status: 403 });
  }

  if (path === "/two-factor/re-enroll" && request.method === "POST") {
    return reenrollAdminTwoFactor(request);
  }

  const response = await auth.handler(await withTrustedClientIp(request, ip));

  if (path === "/sign-in/email" && email) {
    if (response.status === 401) await recordLoginFailure(email, ip);
    else if (response.status < 400) await clearLoginFailures(email, ip);
  }

  // Phase S part 3: log the attempt and queue any alert. trackSignIn never throws and never waits on mail.
  if (signIn) {
    await trackSignIn({
      user: signInUser,
      email: signIn,
      success: response.status < 400,
      ip,
      userAgent,
      checkLockout: response.status === 401,
    });
  }

  return response;
}
