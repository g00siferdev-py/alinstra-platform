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

async function readEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email : null;
  } catch {
    return null;
  }
}

function tooMany(): Response {
  return Response.json({ message: "Too many attempts. Try again later." }, { status: 429 });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = authPath(request);
  const email = request.method === "POST" ? await readEmail(request) : null;
  const ip = clientIp(request);

  if (path === "/sign-in/email" && email && (await loginLocked(email, ip))) {
    return tooMany();
  }

  if ((path === "/request-password-reset" || path === "/forget-password") && email) {
    if (await passwordResetLimited(email)) return tooMany();
    await recordPasswordResetRequest(email);
  }

  const response = await auth.handler(request);

  if (path === "/sign-in/email" && email) {
    if (response.status === 401) await recordLoginFailure(email, ip);
    else if (response.status < 400) await clearLoginFailures(email, ip);
  }

  return response;
}
