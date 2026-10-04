-- Phase 4b: call transcripts, recordings, access, retention.
-- CallRecord gains encrypted transcript/summary/caller/raw-event fields, recording status and R2 key,
-- outcome/sentiment/cost, purgedAt. Client gains callRetentionDays + last purge. User gains canViewCalls.
-- ClientMessage gains retellCallId for message <-> call links.

-- AlterTable
ALTER TABLE "call_record" ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "callerE164Cipher" TEXT,
ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "inVoicemail" BOOLEAN,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "purgedAt" TIMESTAMP(3),
ADD COLUMN     "rawEventsCipher" TEXT,
ADD COLUMN     "recordingBytes" INTEGER,
ADD COLUMN     "recordingContentType" TEXT,
ADD COLUMN     "recordingError" TEXT,
ADD COLUMN     "recordingKey" TEXT,
ADD COLUMN     "recordingStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "sentiment" TEXT,
ADD COLUMN     "successful" BOOLEAN,
ADD COLUMN     "summaryCipher" TEXT,
ADD COLUMN     "transcriptCipher" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "client" ADD COLUMN     "callRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "lastCallPurgeAt" TIMESTAMP(3),
ADD COLUMN     "lastCallPurgeCount" INTEGER;

-- AlterTable
ALTER TABLE "client_message" ADD COLUMN     "retellCallId" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "canViewCalls" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "call_record_clientId_startedAt_idx" ON "call_record"("clientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "call_record_clientId_outcome_idx" ON "call_record"("clientId", "outcome");

-- CreateIndex
CREATE INDEX "client_message_retellCallId_idx" ON "client_message"("retellCallId");
