-- Phase 5b-i: AI onboarding interview sessions.

CREATE TABLE "interview_session" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "draftId" TEXT,
    "industry" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "interview_session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interview_session_clientId_createdAt_idx" ON "interview_session"("clientId", "createdAt");
CREATE INDEX "interview_session_status_createdAt_idx" ON "interview_session"("status", "createdAt");

ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
