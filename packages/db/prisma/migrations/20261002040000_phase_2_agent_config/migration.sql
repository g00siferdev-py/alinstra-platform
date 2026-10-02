-- AlterTable
ALTER TABLE "client" ADD COLUMN "namePronunciation" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN "notices" JSONB;

-- CreateTable
CREATE TABLE "agent_config" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "promptTruncated" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "knowledgeBaseId" TEXT,
    "knowledgeVersion" INTEGER,
    "documentIds" JSONB NOT NULL,
    "voice" JSONB,
    "greeting" TEXT,
    "tools" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "platformAgentId" TEXT,
    "source" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_update" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "holdReason" TEXT,
    "agentConfigId" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "quick_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "feeCents" INTEGER,
    "agentConfigId" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_config_clientId_version_key" ON "agent_config"("clientId", "version");

-- CreateIndex
CREATE INDEX "agent_config_clientId_status_idx" ON "agent_config"("clientId", "status");

-- One active config per client. Prompt text is never updated in place.
CREATE UNIQUE INDEX "agent_config_one_active" ON "agent_config"("clientId") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "quick_update_clientId_status_idx" ON "quick_update"("clientId", "status");

-- CreateIndex
CREATE INDEX "change_request_clientId_status_idx" ON "change_request"("clientId", "status");

-- AddForeignKey
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_base"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_update" ADD CONSTRAINT "quick_update_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
