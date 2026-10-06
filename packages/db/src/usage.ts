import { prisma } from "./client";
import type { Prisma } from "./generated/prisma/client";
import { assertTenantContext, type TenantContext } from "./tenant";

/** Same rule the portal already shows: each call bills ceil(durationSeconds / 60) minutes. */
export function billableMinutesOf(durationSeconds: number): number {
  return Math.ceil(Math.max(0, durationSeconds) / 60);
}

export type UsageUpsertInput = {
  clientId: string;
  callRecordId: string;
  retellCallId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  costCents: number | null;
  internal: boolean;
};

type Tx = Prisma.TransactionClient;

/**
 * Creates or updates a UsageRecord for an ended call. Idempotent on callRecordId.
 * When duration changes on a later event, updates the row. Meter delta reporting is Part 3.
 */
export async function upsertUsageRecord(tx: Tx, input: UsageUpsertInput): Promise<{ created: boolean; updated: boolean }> {
  const durationSeconds = Math.max(0, Math.round(input.durationSeconds));
  const billableMinutes = billableMinutesOf(durationSeconds);
  const existing = await tx.usageRecord.findUnique({ where: { callRecordId: input.callRecordId } });
  if (!existing) {
    await tx.usageRecord.create({
      data: {
        clientId: input.clientId,
        callRecordId: input.callRecordId,
        retellCallId: input.retellCallId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationSeconds,
        billableMinutes,
        costCents: input.costCents,
        internal: input.internal,
      },
    });
    return { created: true, updated: false };
  }
  const unchanged =
    existing.startedAt.getTime() === input.startedAt.getTime() &&
    existing.endedAt.getTime() === input.endedAt.getTime() &&
    existing.durationSeconds === durationSeconds &&
    existing.billableMinutes === billableMinutes &&
    existing.costCents === input.costCents;
  if (unchanged) return { created: false, updated: false };
  // TODO(Part 3): if meterReportedAt is already set, report a meter delta for the billableMinutes change.
  await tx.usageRecord.update({
    where: { id: existing.id },
    data: {
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationSeconds,
      billableMinutes,
      costCents: input.costCents,
      internal: input.internal,
    },
  });
  return { created: false, updated: true };
}

function scopeClientId(ctx: TenantContext, clientId: string): string | null {
  assertTenantContext(ctx);
  if (ctx.role === "admin") {
    if (ctx.clientId && ctx.clientId !== clientId) return null;
    return clientId;
  }
  return ctx.clientId === clientId ? clientId : null;
}

/** Tenant-scoped reader for the usage ledger. Staff and owners are pinned to their client. */
export function usageRecords(ctx: TenantContext) {
  assertTenantContext(ctx);
  return {
    list(clientId: string, filter: { from?: Date | null; to?: Date | null; limit?: number } = {}) {
      const scoped = scopeClientId(ctx, clientId);
      if (!scoped) return Promise.resolve([]);
      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
      return prisma.usageRecord.findMany({
        where: {
          clientId: scoped,
          ...(filter.from || filter.to
            ? { startedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
            : {}),
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          clientId: true,
          callRecordId: true,
          retellCallId: true,
          startedAt: true,
          endedAt: true,
          durationSeconds: true,
          billableMinutes: true,
          costCents: true,
          internal: true,
          meterReportedAt: true,
          createdAt: true,
        },
      });
    },
    /** Sum of billable minutes in [from, to] for one client. */
    async sumMinutes(clientId: string, from: Date, to?: Date | null): Promise<number> {
      const scoped = scopeClientId(ctx, clientId);
      if (!scoped) return 0;
      const rows = await prisma.usageRecord.findMany({
        where: {
          clientId: scoped,
          startedAt: { gte: from, ...(to ? { lte: to } : {}) },
        },
        select: { billableMinutes: true },
      });
      return rows.reduce((sum, row) => sum + row.billableMinutes, 0);
    },
  };
}

export type UsageBackfillReport = {
  scanned: number;
  created: number;
  skipped: number;
  dryRun: boolean;
};

/**
 * Creates UsageRecord rows for existing ended CallRecords. Idempotent; never logs values.
 */
export async function backfillUsageRecords(opts: { dryRun?: boolean; batch?: number; log?: (line: string) => void } = {}): Promise<UsageBackfillReport> {
  const dryRun = opts.dryRun === true;
  const batch = Math.min(Math.max(opts.batch ?? 500, 1), 2000);
  const log = opts.log ?? (() => undefined);
  let scanned = 0;
  let created = 0;
  let skipped = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.callRecord.findMany({
      where: { endedAt: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: batch,
      select: {
        id: true,
        clientId: true,
        retellCallId: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        durationSeconds: true,
        costCents: true,
        client: { select: { internal: true } },
        usageRecord: { select: { id: true } },
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned += 1;
      cursor = row.id;
      if (row.usageRecord) {
        skipped += 1;
        continue;
      }
      if (!row.endedAt) {
        skipped += 1;
        continue;
      }
      const startedAt = row.startedAt ?? row.createdAt;
      const durationSeconds = row.durationSeconds ?? 0;
      if (!dryRun) {
        await prisma.usageRecord.create({
          data: {
            clientId: row.clientId,
            callRecordId: row.id,
            retellCallId: row.retellCallId,
            startedAt,
            endedAt: row.endedAt,
            durationSeconds,
            billableMinutes: billableMinutesOf(durationSeconds),
            costCents: row.costCents,
            internal: row.client.internal,
          },
        });
      }
      created += 1;
    }
    if (rows.length < batch) break;
  }
  log(`scanned=${scanned} created=${created} skipped=${skipped} dryRun=${dryRun}`);
  return { scanned, created, skipped, dryRun };
}
