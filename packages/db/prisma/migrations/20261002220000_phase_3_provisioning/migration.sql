-- AlterTable
ALTER TABLE "client" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client" ADD COLUMN "weeklyHours" JSONB;
ALTER TABLE "client" ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "client" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "client" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "client" ADD COLUMN "stripeCheckoutUrl" TEXT;
ALTER TABLE "client" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN "serviceEndsAt" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN "retellLlmId" TEXT;
ALTER TABLE "client" ADD COLUMN "retellAgentId" TEXT;
ALTER TABLE "client" ADD COLUMN "phoneE164" TEXT;
ALTER TABLE "client" ADD COLUMN "agentSyncStatus" TEXT NOT NULL DEFAULT 'not_provisioned';
ALTER TABLE "client" ADD COLUMN "agentSyncError" TEXT;
ALTER TABLE "client" ADD COLUMN "syncedConfigId" TEXT;
ALTER TABLE "client" ADD COLUMN "liveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "transfer_target" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfer_target_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_message" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "callerName" TEXT NOT NULL,
    "callbackNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "call_record" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "retellCallId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "callerMasked" TEXT NOT NULL,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provisioning_run" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "provisioning_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provisioning_step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "provisioning_step_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_price" (
    "id" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stripe_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_target_clientId_idx" ON "transfer_target"("clientId");
CREATE INDEX "client_message_clientId_createdAt_idx" ON "client_message"("clientId", "createdAt");
CREATE UNIQUE INDEX "call_record_retellCallId_key" ON "call_record"("retellCallId");
CREATE INDEX "call_record_clientId_createdAt_idx" ON "call_record"("clientId", "createdAt");
CREATE INDEX "provisioning_run_clientId_createdAt_idx" ON "provisioning_run"("clientId", "createdAt");
CREATE UNIQUE INDEX "provisioning_step_runId_name_key" ON "provisioning_step"("runId", "name");
CREATE UNIQUE INDEX "stripe_price_lookupKey_key" ON "stripe_price"("lookupKey");
CREATE INDEX "stripe_price_planCode_kind_idx" ON "stripe_price"("planCode", "kind");

-- AddForeignKey
ALTER TABLE "transfer_target" ADD CONSTRAINT "transfer_target_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_message" ADD CONSTRAINT "client_message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provisioning_run" ADD CONSTRAINT "provisioning_run_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provisioning_step" ADD CONSTRAINT "provisioning_step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "provisioning_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
