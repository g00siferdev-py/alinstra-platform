-- Phase B Part 3: track reported meter minutes and report-failure bookkeeping for UsageRecord.
ALTER TABLE "usage_record" ADD COLUMN IF NOT EXISTS "meterReportedMinutes" INTEGER;
ALTER TABLE "usage_record" ADD COLUMN IF NOT EXISTS "meterReportFailedAt" TIMESTAMP(3);
ALTER TABLE "usage_record" ADD COLUMN IF NOT EXISTS "meterFailureNotifiedAt" TIMESTAMP(3);
