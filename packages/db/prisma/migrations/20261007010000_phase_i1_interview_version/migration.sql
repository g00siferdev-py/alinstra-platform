-- Phase I.1: optimistic concurrency for interview turns.

ALTER TABLE "interview_session" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

