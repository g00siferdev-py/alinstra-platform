import { auth } from "./auth";
import {
  clearLoginFailures,
  clientIp,
  loginLocked,
  passwordResetLimited,
  recordLoginFailure,
  recordPasswordResetRequest,
} from "./lockout";

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

/** Better Auth reads `x-real-ip`. Replace forwarded headers with the IP we already trusted. */
export function withTrustedClientIp(request: Request, ip: string): Request {
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-for");
  if (ip === "local") headers.delete("x-real-ip");
  else headers.set("x-real-ip", ip);
  return new Request(request, { headers });
}

function tooMany(): Response {
  return Response.json({ message: "Too many attempts. Try again later." }, { status: 429 });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = authPath(request);
  const email = request.method === "POST" ? await readEmail(request) : null;
  const ip = clientIp(request);

  if (path === "/sign-in/email" && request.method === "POST" && !email) {
    return Response.json({ message: "Email is required." }, { status: 400 });
  }

  if (path === "/sign-in/email" && email && (await loginLocked(email, ip))) {
    return tooMany();
  }

  if ((path === "/request-password-reset" || path === "/forget-password") && email) {
    if (await passwordResetLimited(email)) return tooMany();
    await recordPasswordResetRequest(email);
  }

  const response = await auth.handler(withTrustedClientIp(request, ip));

  if (path === "/sign-in/email" && email) {
    if (response.status === 401) await recordLoginFailure(email, ip);
    else if (response.status < 400) await clearLoginFailures(email, ip);
  }

  return response;
}
