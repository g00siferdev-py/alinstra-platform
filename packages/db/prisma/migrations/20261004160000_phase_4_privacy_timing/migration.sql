-- Public contact details are the only phone and email the receptionist may give a caller.
ALTER TABLE "client" ADD COLUMN "publicPhone" TEXT;
ALTER TABLE "client" ADD COLUMN "publicEmail" TEXT;

-- A number is bought only after an admin confirms it on the run.
ALTER TABLE "provisioning_run" ADD COLUMN "numberApprovedAt" TIMESTAMP(3);

-- Client zero answers on its own Alinstra number, so that number is its public phone.
UPDATE "client" SET "publicPhone" = "phoneE164" WHERE "internal" = true AND "publicPhone" IS NULL AND "phoneE164" IS NOT NULL;
