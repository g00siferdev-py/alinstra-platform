-- AlterTable
ALTER TABLE "client" ADD COLUMN "stripeCheckoutExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "client_stripeCustomerId_key" ON "client"("stripeCustomerId");
CREATE UNIQUE INDEX "client_stripeSubscriptionId_key" ON "client"("stripeSubscriptionId");
CREATE UNIQUE INDEX "client_retellLlmId_key" ON "client"("retellLlmId");
CREATE UNIQUE INDEX "client_retellAgentId_key" ON "client"("retellAgentId");
CREATE UNIQUE INDEX "client_phoneE164_key" ON "client"("phoneE164");

-- One open provision run and one open teardown run per client.
CREATE UNIQUE INDEX "provisioning_run_one_open_provision" ON "provisioning_run"("clientId") WHERE "kind" = 'provision' AND "status" IN ('running', 'failed');
CREATE UNIQUE INDEX "provisioning_run_one_open_teardown" ON "provisioning_run"("clientId") WHERE "kind" = 'teardown' AND "status" IN ('running', 'failed');

-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_event_eventId_key" ON "stripe_event"("eventId");
