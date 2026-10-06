-- Phase S part 1: cipher columns (AES-256-GCM via @alinstra/crypto, keyring v2).
-- Additive and backward-compatible: old code keeps reading and writing the plaintext columns, which are now
-- nullable. Plaintext columns are NOT dropped here; a later phase drops them after staging and production are
-- verified and `packages/db/scripts/encrypt-backfill.ts` reports zero remaining plaintext rows.

ALTER TABLE "client_message" ADD COLUMN IF NOT EXISTS "callerNameCipher" TEXT;
ALTER TABLE "client_message" ADD COLUMN IF NOT EXISTS "callbackNumberCipher" TEXT;
ALTER TABLE "client_message" ADD COLUMN IF NOT EXISTS "bodyCipher" TEXT;
ALTER TABLE "client_message" ADD COLUMN IF NOT EXISTS "callbackMasked" TEXT;
ALTER TABLE "client_message" ALTER COLUMN "callerName" DROP NOT NULL;
ALTER TABLE "client_message" ALTER COLUMN "callbackNumber" DROP NOT NULL;
ALTER TABLE "client_message" ALTER COLUMN "body" DROP NOT NULL;

ALTER TABLE "transfer_target" ADD COLUMN IF NOT EXISTS "e164Cipher" TEXT;
ALTER TABLE "transfer_target" ADD COLUMN IF NOT EXISTS "e164Masked" TEXT;
ALTER TABLE "transfer_target" ALTER COLUMN "e164" DROP NOT NULL;

ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "staffCipher" TEXT;

ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "extractedTextCipher" TEXT;
