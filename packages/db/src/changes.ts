import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import type { Role, TenantContext } from "./tenant";

export type Actor = TenantContext & { id: string };

export async function recordChange(
  tx: Prisma.TransactionClient,
  entry: {
    clientId: string | null;
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await writeChange(tx, entry);
}

export async function recordEmailChange(input: {
  userId: string;
  role: Role;
  clientId: string | null;
  previousEmail: string;
  nextEmail: string;
}): Promise<void> {
  if (input.previousEmail.toLowerCase() === input.nextEmail.toLowerCase()) return;
  const actor: Actor = input.role === "admin"
    ? { id: input.userId, role: "admin" }
    : { id: input.userId, role: input.role, clientId: input.clientId ?? "" };
  if (actor.role !== "admin" && !actor.clientId) return;
  await prisma.$transaction(async (tx) => {
    await recordChange(tx, {
      clientId: input.clientId,
      actor,
      action: "user.email_changed",
      entityType: "user",
      entityId: input.userId,
      summary: "Login email changed",
      before: { email: input.previousEmail },
      after: { email: input.nextEmail },
    });
  });
}

async function writeChange(
  tx: Prisma.TransactionClient,
  entry: Parameters<typeof recordChange>[1],
): Promise<void> {
  await tx.changeLog.create({
    data: {
      clientId: entry.clientId,
      actorUserId: entry.actor.id,
      actorRole: entry.actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      before: entry.before,
      after: entry.after,
    },
  });
}
