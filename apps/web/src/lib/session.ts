import { ADMIN_SESSION_MS, auth, readAllowedSession } from "@alinstra/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function peekSession() {
  const headerList = await headers();
  const session = await readAllowedSession(headerList);
  if (session === "blocked" || !session) return null;
  if (session.user.role === "admin") {
    const created = new Date(session.session.createdAt).getTime();
    if (Date.now() - created >= ADMIN_SESSION_MS) return null;
  }
  return session;
}

export async function getSession() {
  const headerList = await headers();
  const session = await readAllowedSession(headerList);
  if (session === "blocked") redirect("/login?notice=unavailable");
  if (!session) return null;
  if (session.user.role === "admin") {
    const created = new Date(session.session.createdAt).getTime();
    if (Date.now() - created >= ADMIN_SESSION_MS) {
      await auth.api.signOut({ headers: headerList });
      return null;
    }
  }
  return session;
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== "admin") redirect("/home");
  if (!session.user.twoFactorEnabled) redirect("/account/security");
  return session;
}
