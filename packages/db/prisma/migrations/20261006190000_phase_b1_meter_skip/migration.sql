-- Phase B.1: permanently skip UsageRecords that Stripe cannot bill (age / before paidAt).
ALTER TABLE "usage_record" ADD COLUMN IF NOT EXISTS "meterSkippedAt" TIMESTAMP(3);
ALTER TABLE "usage_record" ADD COLUMN IF NOT EXISTS "meterSkipReason" TEXT;
CREATE INDEX IF NOT EXISTS "usage_record_meterSkippedAt_meterReportedAt_endedAt_idx"
  ON "usage_record"("meterSkippedAt", "meterReportedAt", "endedAt");
