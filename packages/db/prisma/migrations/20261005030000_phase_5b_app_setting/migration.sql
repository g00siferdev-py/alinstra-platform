-- Phase 5b-i part 4: platform AppSetting for interview config overrides.

CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);
