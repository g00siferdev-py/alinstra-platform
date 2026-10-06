-- Phase B Part 2: self-serve signup fields.
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "selfServe" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
