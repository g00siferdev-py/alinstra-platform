import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { getAppSettings } from "./app-settings";

/** Last backup attempt of any outcome. */
export const BACKUP_LAST_KEY = "backup.last";
/** Last successful backup only; the Services card stales on this, so a later failure can't hide its age. */
export const BACKUP_LAST_SUCCESS_KEY = "backup.lastSuccess";
/** A backup is overdue when the last success is older than this (daily job plus slack). */
export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;

export type BackupStatus = "success" | "failed" | "not_configured";

/** Never contains secrets: `error` is a short sanitised message, `key` is an object key. */
export type BackupRecord = {
  at: string;
  bytes: number;
  key: string | null;
  status: BackupStatus;
  error?: string;
};

function isRecord(value: unknown): value is BackupRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.at === "string" &&
    typeof row.bytes === "number" &&
    (row.status === "success" || row.status === "failed" || row.status === "not_configured")
  );
}

/**
 * Writes the job's own bookkeeping straight to AppSetting. This is system state, not an admin edit,
 * so it deliberately skips `setAppSetting` (admin-only, one ChangeLog row per write) and its audit noise.
 */
export async function recordBackupResult(record: BackupRecord): Promise<void> {
  const value = JSON.parse(JSON.stringify(record)) as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BACKUP_LAST_KEY },
    create: { key: BACKUP_LAST_KEY, value, updatedBy: null },
    update: { value, updatedBy: null },
  });
  if (record.status === "success") {
    await prisma.appSetting.upsert({
      where: { key: BACKUP_LAST_SUCCESS_KEY },
      create: { key: BACKUP_LAST_SUCCESS_KEY, value, updatedBy: null },
      update: { value, updatedBy: null },
    });
  }
}

export type BackupSnapshot = { last: BackupRecord | null; lastSuccess: BackupRecord | null };

export async function getBackupSnapshot(): Promise<BackupSnapshot> {
  const stored = await getAppSettings([BACKUP_LAST_KEY, BACKUP_LAST_SUCCESS_KEY]);
  const last = stored[BACKUP_LAST_KEY];
  const lastSuccess = stored[BACKUP_LAST_SUCCESS_KEY];
  return { last: isRecord(last) ? last : null, lastSuccess: isRecord(lastSuccess) ? lastSuccess : null };
}

export type BackupHealth = "ok" | "stale" | "never";

/** `stale` (shown red) when there is no success within 36 hours; `never` when no backup has ever succeeded. */
export function backupHealth(snapshot: BackupSnapshot, now: Date = new Date()): BackupHealth {
  if (!snapshot.lastSuccess) return "never";
  const age = now.getTime() - new Date(snapshot.lastSuccess.at).getTime();
  return Number.isFinite(age) && age <= BACKUP_STALE_MS ? "ok" : "stale";
}

/** Major version of the connected Postgres server (16, 17, ...), from `server_version_num`. */
export async function postgresServerMajor(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ server_version_num: string }>>`SHOW server_version_num`;
  const num = Number(rows[0]?.server_version_num);
  if (!Number.isFinite(num) || num < 100000) throw new Error("Could not read the Postgres server version");
  return Math.floor(num / 10000);
}
