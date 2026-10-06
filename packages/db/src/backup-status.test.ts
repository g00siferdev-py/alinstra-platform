import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  BACKUP_LAST_KEY,
  BACKUP_LAST_SUCCESS_KEY,
  BACKUP_STALE_MS,
  backupHealth,
  getBackupSnapshot,
  postgresServerMajor,
  recordBackupResult,
  type BackupRecord,
} from "./backup-status";
import { resetTestDatabase } from "./reset-test-database";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-06T12:00:00Z");

function success(hoursAgo: number): BackupRecord {
  return { at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(), bytes: 1234, key: "backups/staging/2026/10/06/x.dump.enc", status: "success" };
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backup status records", () => {
  it("is empty before the first run", async () => {
    expect(await getBackupSnapshot()).toEqual({ last: null, lastSuccess: null });
    expect(backupHealth({ last: null, lastSuccess: null }, NOW)).toBe("never");
  });

  it("stores { at, bytes, key, status } under backup.last and keeps the last success separately", async () => {
    const ok = success(2);
    await recordBackupResult(ok);
    const row = await prisma.appSetting.findUnique({ where: { key: BACKUP_LAST_KEY } });
    expect(row?.value).toEqual(ok);
    expect(row?.updatedBy).toBeNull();

    const failed: BackupRecord = { at: NOW.toISOString(), bytes: 0, key: null, status: "failed", error: "pg_dump failed (exit 1)" };
    await recordBackupResult(failed);
    const snapshot = await getBackupSnapshot();
    expect(snapshot.last).toEqual(failed);
    expect(snapshot.lastSuccess).toEqual(ok);
    expect((await prisma.appSetting.findUnique({ where: { key: BACKUP_LAST_SUCCESS_KEY } }))?.value).toEqual(ok);
    // System bookkeeping must not write ChangeLog rows.
    expect(await prisma.changeLog.count()).toBe(0);
  });

  it("a not_configured run does not erase the last success", async () => {
    await recordBackupResult(success(5));
    await recordBackupResult({ at: NOW.toISOString(), bytes: 0, key: null, status: "not_configured", error: "BACKUP_PASSPHRASE is not set on the worker" });
    const snapshot = await getBackupSnapshot();
    expect(snapshot.last?.status).toBe("not_configured");
    expect(snapshot.lastSuccess?.status).toBe("success");
  });

  it("ignores malformed stored values", async () => {
    await prisma.appSetting.create({ data: { key: BACKUP_LAST_KEY, value: { nonsense: true } } });
    expect(await getBackupSnapshot()).toEqual({ last: null, lastSuccess: null });
  });
});

describe("backupHealth", () => {
  it("is ok within 36 hours of the last success and stale after", () => {
    expect(BACKUP_STALE_MS).toBe(36 * HOUR);
    expect(backupHealth({ last: null, lastSuccess: success(1) }, NOW)).toBe("ok");
    expect(backupHealth({ last: null, lastSuccess: success(36) }, NOW)).toBe("ok");
    expect(backupHealth({ last: null, lastSuccess: success(36.01) }, NOW)).toBe("stale");
    expect(backupHealth({ last: null, lastSuccess: success(200) }, NOW)).toBe("stale");
  });

  it("goes stale when the newest attempt failed and the last success is old", () => {
    const failed: BackupRecord = { at: NOW.toISOString(), bytes: 0, key: null, status: "failed", error: "x" };
    expect(backupHealth({ last: failed, lastSuccess: success(40) }, NOW)).toBe("stale");
  });
});

describe("postgresServerMajor", () => {
  it("reads the major version of the connected server", async () => {
    expect(await postgresServerMajor()).toBeGreaterThanOrEqual(14);
  });
});
