/**
 * Phase B Part 3: report UsageRecord minutes to the Stripe alinstra_minutes Billing Meter.
 *
 * Correction strategy (positive delta only): Stripe meter event adjustments only cancel an
 * event (within ~24h); they cannot change the value. When billableMinutes increases after a
 * successful report, we send a second event with value = delta and identifier
 * `${usageRecordId}:corr:${newMinutes}`. Decreases are not corrected in Stripe (rare; duration
 * usually only grows on later Retell events). Documented fully in BILLING.md (Part 4).
 */
import { METER_EVENT_NAME, type BillingPlatform } from "@alinstra/providers";
import { prisma } from "./client";

const FAILURE_NOTICE_MS = 24 * 60 * 60 * 1000;
/** Stripe rejects meter timestamps older than ~35 days; skip a day early. */
const TOO_OLD_MS = 34 * 24 * 60 * 60 * 1000;
/** After a failure, leave the row out of the next batches so newer rows get a turn. */
const RECENT_FAILURE_MS = 15 * 60 * 1000;

export type ReportUsageDeps = {
  billing: BillingPlatform;
  /** Enqueue an admin email; injectable for tests. */
  notifyAdmin?: (subject: string, text: string) => Promise<void>;
  now?: Date;
};

export type ReportUsageReport = {
  scanned: number;
  reported: number;
  corrected: number;
  failed: number;
  notified: number;
  skipped: number;
};

type PendingRow = {
  id: string;
  billableMinutes: number;
  endedAt: Date;
  meterReportedAt: Date | null;
  meterReportedMinutes: number | null;
  meterReportFailedAt: Date | null;
  meterFailureNotifiedAt: Date | null;
  client: { id: string; stripeCustomerId: string | null; paidAt: Date | null; internal: boolean };
};

function correctionIdentifier(usageRecordId: string, billableMinutes: number): string {
  return `${usageRecordId}:corr:${billableMinutes}`;
}

async function markSuccess(
  row: PendingRow,
  identifier: string,
  reportedMinutes: number,
  now: Date,
): Promise<void> {
  await prisma.usageRecord.update({
    where: { id: row.id },
    data: {
      meterReportedAt: row.meterReportedAt ?? now,
      meterEventId: identifier,
      meterReportedMinutes: reportedMinutes,
      meterReportFailedAt: null,
      meterFailureNotifiedAt: null,
    },
  });
}

async function markFailure(row: PendingRow, now: Date, notifyAdmin?: ReportUsageDeps["notifyAdmin"]): Promise<"notified" | "failed"> {
  const failedAt = row.meterReportFailedAt ?? now;
  const data: { meterReportFailedAt?: Date; meterFailureNotifiedAt?: Date } = {};
  if (!row.meterReportFailedAt) data.meterReportFailedAt = now;

  let notified: "notified" | "failed" = "failed";
  if (!row.meterFailureNotifiedAt && now.getTime() - failedAt.getTime() >= FAILURE_NOTICE_MS) {
    if (notifyAdmin) {
      await notifyAdmin(
        "Meter usage report failing for 24h",
        `UsageRecord ${row.id} (client ${row.client.id}) has failed Stripe meter reporting for over 24 hours. Check worker logs and Stripe meter events.`,
      );
    }
    data.meterFailureNotifiedAt = now;
    notified = "notified";
  }

  if (Object.keys(data).length > 0) {
    await prisma.usageRecord.update({ where: { id: row.id }, data });
  }
  return notified;
}

/**
 * Mark rows Stripe cannot bill so they never starve the meter queue.
 * Returns how many rows were newly skipped.
 */
async function markUnbillableRows(now: Date): Promise<number> {
  const tooOldCutoff = new Date(now.getTime() - TOO_OLD_MS);
  const tooOld = await prisma.usageRecord.updateMany({
    where: {
      meterReportedAt: null,
      meterSkippedAt: null,
      endedAt: { lt: tooOldCutoff },
    },
    data: { meterSkippedAt: now, meterSkipReason: "too_old" },
  });

  const beforePaid = await prisma.$executeRaw`
    UPDATE usage_record AS u
    SET "meterSkippedAt" = ${now}, "meterSkipReason" = 'before_paid'
    FROM client AS c
    WHERE c.id = u."clientId"
      AND u."meterReportedAt" IS NULL
      AND u."meterSkippedAt" IS NULL
      AND c."paidAt" IS NOT NULL
      AND u."endedAt" < c."paidAt"
  `;

  return tooOld.count + Number(beforePaid);
}

/**
 * Send meter events for paid, non-internal UsageRecords that still need an initial report
 * or a positive-delta correction after duration changed.
 */
export async function reportUsageToStripe(deps: ReportUsageDeps): Promise<ReportUsageReport> {
  const now = deps.now ?? new Date();
  const report: ReportUsageReport = { scanned: 0, reported: 0, corrected: 0, failed: 0, notified: 0, skipped: 0 };
  report.skipped += await markUnbillableRows(now);

  const recentFailureBefore = new Date(now.getTime() - RECENT_FAILURE_MS);
  const clientFilter = {
    internal: false,
    paidAt: { not: null },
    stripeCustomerId: { not: null },
  } as const;
  const select = {
    id: true,
    billableMinutes: true,
    endedAt: true,
    meterReportedAt: true,
    meterReportedMinutes: true,
    meterReportFailedAt: true,
    meterFailureNotifiedAt: true,
    client: { select: { id: true, stripeCustomerId: true, paidAt: true, internal: true } },
  } as const;

  const unreported = await prisma.usageRecord.findMany({
    where: {
      internal: false,
      meterReportedAt: null,
      meterSkippedAt: null,
      client: clientFilter,
      OR: [{ meterReportFailedAt: null }, { meterReportFailedAt: { lt: recentFailureBefore } }],
    },
    select,
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    take: 400,
  });

  // Positive deltas: already reported, but billableMinutes grew (column compare via raw).
  const corrections = await prisma.$queryRaw<
    Array<{
      id: string;
      billableMinutes: number;
      endedAt: Date;
      meterReportedAt: Date;
      meterReportedMinutes: number;
      meterReportFailedAt: Date | null;
      meterFailureNotifiedAt: Date | null;
      clientId: string;
      stripeCustomerId: string;
      paidAt: Date;
      clientInternal: boolean;
    }>
  >`
    SELECT u.id, u."billableMinutes", u."endedAt", u."meterReportedAt", u."meterReportedMinutes",
           u."meterReportFailedAt", u."meterFailureNotifiedAt",
           c.id AS "clientId", c."stripeCustomerId", c."paidAt", c.internal AS "clientInternal"
    FROM usage_record u
    INNER JOIN client c ON c.id = u."clientId"
    WHERE u.internal = false
      AND u."meterSkippedAt" IS NULL
      AND c.internal = false
      AND c."paidAt" IS NOT NULL
      AND c."stripeCustomerId" IS NOT NULL
      AND u."meterReportedAt" IS NOT NULL
      AND u."meterReportedMinutes" IS NOT NULL
      AND u."billableMinutes" > u."meterReportedMinutes"
      AND (u."meterReportFailedAt" IS NULL OR u."meterReportFailedAt" < ${recentFailureBefore})
    ORDER BY u."endedAt" ASC, u.id ASC
    LIMIT 100
  `;

  const rows: PendingRow[] = [
    ...unreported,
    ...corrections.map((row) => ({
      id: row.id,
      billableMinutes: row.billableMinutes,
      endedAt: row.endedAt,
      meterReportedAt: row.meterReportedAt,
      meterReportedMinutes: row.meterReportedMinutes,
      meterReportFailedAt: row.meterReportFailedAt,
      meterFailureNotifiedAt: row.meterFailureNotifiedAt,
      client: {
        id: row.clientId,
        stripeCustomerId: row.stripeCustomerId,
        paidAt: row.paidAt,
        internal: row.clientInternal,
      },
    })),
  ];

  for (const row of rows) {
    report.scanned += 1;
    const customerId = row.client.stripeCustomerId;
    if (!customerId || !row.client.paidAt || row.client.internal) {
      report.skipped += 1;
      continue;
    }

    const already = row.meterReportedMinutes ?? 0;
    const isInitial = row.meterReportedAt === null;
    const delta = row.billableMinutes - already;

    if (!isInitial && delta <= 0) {
      report.skipped += 1;
      continue;
    }

    const value = isInitial ? row.billableMinutes : delta;
    if (value <= 0) {
      report.skipped += 1;
      continue;
    }

    const identifier = isInitial ? row.id : correctionIdentifier(row.id, row.billableMinutes);

    try {
      const result = await deps.billing.reportMeterEvent({
        eventName: METER_EVENT_NAME,
        customerId,
        value,
        timestamp: row.endedAt,
        identifier,
      });
      await markSuccess(row, result.identifier, row.billableMinutes, now);
      if (isInitial) report.reported += 1;
      else report.corrected += 1;
    } catch {
      const outcome = await markFailure(row, now, deps.notifyAdmin);
      report.failed += 1;
      if (outcome === "notified") report.notified += 1;
    }
  }

  return report;
}
