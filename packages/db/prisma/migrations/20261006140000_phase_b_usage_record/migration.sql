-- Phase B part 1: usage ledger for billing and reports.
-- Additive and backward-compatible: a new table. Existing CallRecord rows are backfilled by
-- packages/db/scripts/usage-backfill.ts. UsageRecord never stores caller data or content and
-- survives the CallRecord retention purge.

CREATE TABLE "usage_record" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "callRecordId" TEXT NOT NULL,
    "retellCallId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "billableMinutes" INTEGER NOT NULL,
    "costCents" INTEGER,
    "internal" BOOLEAN NOT NULL,
    "meterReportedAt" TIMESTAMP(3),
    "meterEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_record_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_record_callRecordId_key" ON "usage_record"("callRecordId");
CREATE UNIQUE INDEX "usage_record_retellCallId_key" ON "usage_record"("retellCallId");
CREATE INDEX "usage_record_clientId_startedAt_idx" ON "usage_record"("clientId", "startedAt");
CREATE INDEX "usage_record_clientId_meterReportedAt_idx" ON "usage_record"("clientId", "meterReportedAt");

ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "call_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
