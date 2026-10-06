-- Phase S part 2: read-access audit log.
-- Additive and backward-compatible: a new table nothing in the old code touches. No foreign keys, so rows
-- outlive a removed client or user until the nightly purge deletes anything older than 400 days.

CREATE TABLE IF NOT EXISTS "access_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "impersonating" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER,

    CONSTRAINT "access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "access_log_clientId_at_idx" ON "access_log"("clientId", "at");
CREATE INDEX IF NOT EXISTS "access_log_actorUserId_at_idx" ON "access_log"("actorUserId", "at");
CREATE INDEX IF NOT EXISTS "access_log_at_idx" ON "access_log"("at");
