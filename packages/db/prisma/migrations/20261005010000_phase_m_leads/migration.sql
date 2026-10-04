-- Phase M: marketing lead submissions from /start.

CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "business" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "missedCalls" TEXT NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'marketing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactedAt" TIMESTAMP(3),
    "convertedClientId" TEXT,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_createdAt_idx" ON "lead"("createdAt");

ALTER TABLE "lead" ADD CONSTRAINT "lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
