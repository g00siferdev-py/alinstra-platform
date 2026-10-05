-- Phase D: call quality flags for admin to-do and call detail.
ALTER TABLE "call_record" ADD COLUMN "flags" JSONB;
