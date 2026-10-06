-- Phase B Part 4: billing lifecycle (past-due pause, period bounds, plan changes).

ALTER TABLE "client" ADD COLUMN "pastDueSince" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN "stripeCurrentPeriodStart" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN "stripeCurrentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "client" ADD COLUMN "pendingPlanId" TEXT;

CREATE INDEX "client_billingStatus_pastDueSince_idx" ON "client"("billingStatus", "pastDueSince");

ALTER TABLE "client" ADD CONSTRAINT "client_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "plan_change_request" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fromPlanId" TEXT NOT NULL,
    "toPlanId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "plan_change_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_change_request_clientId_status_idx" ON "plan_change_request"("clientId", "status");
CREATE INDEX "plan_change_request_status_idx" ON "plan_change_request"("status");

ALTER TABLE "plan_change_request" ADD CONSTRAINT "plan_change_request_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_change_request" ADD CONSTRAINT "plan_change_request_fromPlanId_fkey" FOREIGN KEY ("fromPlanId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_change_request" ADD CONSTRAINT "plan_change_request_toPlanId_fkey" FOREIGN KEY ("toPlanId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
