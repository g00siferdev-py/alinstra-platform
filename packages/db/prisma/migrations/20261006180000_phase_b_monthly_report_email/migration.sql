-- Phase B Part 5: owner monthly report email opt-out (default on).

ALTER TABLE "client" ADD COLUMN "monthlyReportEmail" BOOLEAN NOT NULL DEFAULT true;
