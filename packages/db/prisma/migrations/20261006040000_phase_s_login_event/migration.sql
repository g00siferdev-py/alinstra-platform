-- Phase S part 3: sign-in attempt log for security alerts.
-- Additive and backward-compatible: a new table nothing in the old code touches. No foreign keys, so rows
-- outlive a removed user until the nightly purge deletes anything older than 180 days.

CREATE TABLE IF NOT EXISTS "login_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "ipPrefix" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "login_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_event_userId_success_at_idx" ON "login_event"("userId", "success", "at");
CREATE INDEX IF NOT EXISTS "login_event_email_at_idx" ON "login_event"("email", "at");
CREATE INDEX IF NOT EXISTS "login_event_at_idx" ON "login_event"("at");
