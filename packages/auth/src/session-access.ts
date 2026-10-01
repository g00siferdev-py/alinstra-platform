import { auth, type AuthSession } from "./auth";
import { sessionBlockedForUser } from "./client-access";
import { prisma } from "@alinstra/db";

export async function readAllowedSession(headers: Headers): Promise<AuthSession | "blocked" | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  if (!(await sessionBlockedForUser(session.user.id))) return session;
  await prisma.session.deleteMany({ where: { userId: session.user.id } });
  return "blocked";
}
