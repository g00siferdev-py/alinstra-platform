-- Phase Q: Solo standard price, and columns for automatic go-live.

UPDATE "plan"
SET
  "monthlyPriceCents" = 4900,
  "setupFeeCents" = 4900,
  "includedMinutes" = 100,
  "overagePerMinuteCents" = 75,
  "updatedAt" = NOW()
WHERE "code" = 'solo';

ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "stripeLivemode" BOOLEAN;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "goLiveReview" JSONB;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "autoGoLiveAt" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "adminPausedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "client_autoGoLiveAt_idx" ON "client"("autoGoLiveAt");
