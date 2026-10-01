import type { Prisma } from "./generated/prisma/client";
import type { TenantContext } from "./tenant";

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
