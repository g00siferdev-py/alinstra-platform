-- AlterTable
ALTER TABLE "client" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "compliance" JSONB,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "coverage" JSONB,
ADD COLUMN     "features" JSONB,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overrideIncludedChangesPerMonth" INTEGER,
ADD COLUMN     "overrideIncludedMinutes" INTEGER,
ADD COLUMN     "overrideMonthlyPriceCents" INTEGER,
ADD COLUMN     "overrideOveragePerMinuteCents" INTEGER,
ADD COLUMN     "overrideSetupFeeCents" INTEGER,
ADD COLUMN     "phone" JSONB,
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "portalOwnerEmail" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "setupFeeWaived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'lead',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
ADD COLUMN     "voice" JSONB,
ADD COLUMN     "websiteNotes" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "wizardSubmittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "includedMinutes" INTEGER NOT NULL,
    "overagePerMinuteCents" INTEGER NOT NULL,
    "setupFeeCents" INTEGER NOT NULL,
    "includedChangesPerMonth" INTEGER,
    "extraChangeFeeCents" INTEGER NOT NULL,
    "recallMonthlyCents" INTEGER NOT NULL,
    "recallPerBookingCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wizard_draft" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wizard_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "hours" JSONB,
    "services" JSONB,
    "faqs" JSONB,
    "policies" JSONB,
    "staff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "extractedText" TEXT,
    "extractedTextTruncated" BOOLEAN NOT NULL DEFAULT false,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_log" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "impersonating" BOOLEAN NOT NULL DEFAULT false,
    "impersonatedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "wizard_draft_clientId_key" ON "wizard_draft"("clientId");

-- CreateIndex
CREATE INDEX "knowledge_base_clientId_idx" ON "knowledge_base"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_clientId_version_key" ON "knowledge_base"("clientId", "version");

-- CreateIndex
CREATE INDEX "knowledge_document_clientId_idx" ON "knowledge_document"("clientId");

-- CreateIndex
CREATE INDEX "knowledge_document_knowledgeBaseId_idx" ON "knowledge_document"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "change_log_clientId_createdAt_idx" ON "change_log"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "client_status_idx" ON "client"("status");

-- CreateIndex
CREATE INDEX "client_archivedAt_idx" ON "client"("archivedAt");

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wizard_draft" ADD CONSTRAINT "wizard_draft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
