import { prisma } from "@alinstra/db";

export const ARCHIVED_CLIENT_MESSAGE = "This account cannot be used.";

export async function sessionBlockedForUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, clientId: true },
  });
  if (!user || user.role === "admin" || !user.clientId) return false;
  const client = await prisma.client.findUnique({
    where: { id: user.clientId },
    select: { archivedAt: true },
  });
  return !client || client.archivedAt !== null;
}
