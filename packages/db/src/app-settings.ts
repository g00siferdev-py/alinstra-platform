import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { recordChange, type Actor } from "./changes";
import { assertTenantContext } from "./tenant";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function getAppSetting(key: string): Promise<unknown | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row ? row.value : null;
}

export async function getAppSettings(keys: string[]): Promise<Record<string, unknown>> {
  if (keys.length === 0) return {};
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function setAppSetting(ctx: Actor, key: string, value: unknown) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can change settings.");
  const before = await prisma.appSetting.findUnique({ where: { key } });
  const row = await prisma.$transaction(async (tx) => {
    const next = await tx.appSetting.upsert({
      where: { key },
      create: { key, value: json(value), updatedBy: ctx.id },
      update: { value: json(value), updatedBy: ctx.id },
    });
    await recordChange(tx, {
      clientId: null,
      actor: ctx,
      action: "app_setting.updated",
      entityType: "app_setting",
      entityId: key,
      summary: `Updated setting ${key}`,
      before: before ? { value: before.value } : undefined,
      after: { value: next.value },
    });
    return next;
  });
  return row;
}
