import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logged } = vi.hoisted(() => ({ logged: [] as Array<{ level: string; message: string; fields: Record<string, unknown> }> }));

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({}),
  log: (level: string, message: string, fields: Record<string, unknown>) => logged.push({ level, message, fields }),
}));
vi.mock("@alinstra/db", () => ({ postgresServerMajor: vi.fn(), recordBackupResult: vi.fn() }));
vi.mock("@alinstra/queue", () => ({ enqueueSendAdminNotice: vi.fn(), getRedis: vi.fn() }));
vi.mock("@alinstra/storage", () => ({ getBackupStorage: () => ({}) }));

import { createBackupDecryptStream } from "@alinstra/crypto";
import type { BackupRecord } from "@alinstra/db";
import {
  BackupFailedError,
  backupEnvLabel,
  backupKeyFor,
  parsePgMajor,
  pgEnvFromUrl,
  runBackupDb,
  sanitizeError,
  type BackupDeps,
  type DumpProcess,
} from "./backup";

const PASSPHRASE = "a long enough backup passphrase";
const DB_URL = "postgresql://alinstra:s3cretpw@db.internal:5432/alinstra?schema=public";
const NOW = new Date("2026-10-06T07:30:00.123Z");
const DAY = 24 * 60 * 60 * 1000;

function harness(overrides: Partial<BackupDeps> = {}, dump: string | Error = "PGDMP fake custom-format archive") {
  const uploads = new Map<string, Buffer>();
  const stored: Array<{ key: string; size: number; lastModified: Date }> = [];
  const deleted: string[] = [];
  const records: BackupRecord[] = [];
  const notices: Array<{ subject: string; text: string }> = [];
  const tempRoot = { path: "" };
  const deps: BackupDeps = {
    passphrase: PASSPHRASE,
    appEnv: "staging",
    databaseUrl: DB_URL,
    storage: {
      putFile: async (key, path) => {
        uploads.set(key, await readFile(path));
        stored.push({ key, size: uploads.get(key)?.length ?? 0, lastModified: NOW });
      },
      list: async (prefix) => stored.filter((item) => item.key.startsWith(prefix)),
      delete: async (key) => {
        deleted.push(key);
      },
    },
    pgDumpMajor: async () => 16,
    serverMajor: async () => 16,
    startDump: (): DumpProcess => {
      if (dump instanceof Error) {
        const stdout = new Readable({ read() {} });
        const finished = Promise.reject(dump);
        finished.catch(() => undefined);
        setImmediate(() => stdout.push(null));
        return { stdout, finished };
      }
      return { stdout: Readable.from([Buffer.from(dump)]), finished: Promise.resolve() };
    },
    record: async (record) => {
      records.push(record);
    },
    notify: async (subject, text) => {
      notices.push({ subject, text });
    },
    claimDailyNotice: async () => true,
    now: () => NOW,
    tempDir: undefined,
    ...overrides,
  };
  return { deps, uploads, stored, deleted, records, notices, tempRoot };
}

async function decryptUpload(file: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alinstra-backup-test-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "in.enc"), file);
    const chunks: Buffer[] = [];
    await pipeline(createReadStream(join(dir, "in.enc")), createBackupDecryptStream(PASSPHRASE), async function (source) {
      for await (const piece of source) chunks.push(piece as Buffer);
    });
    return Buffer.concat(chunks).toString();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  logged.length = 0;
});

describe("backup helpers", () => {
  it("builds the object key from env and timestamp", () => {
    expect(backupKeyFor("staging", NOW)).toBe("backups/staging/2026/10/06/alinstra-staging-2026-10-06T07-30-00Z.dump.enc");
  });

  it("falls back to staging and sanitises the env label", () => {
    expect(backupEnvLabel(undefined)).toBe("staging");
    expect(backupEnvLabel("  ")).toBe("staging");
    expect(backupEnvLabel("Production")).toBe("production");
    expect(backupEnvLabel("../evil env")).toBe("evil-env");
  });

  it("parses pg_dump major versions", () => {
    expect(parsePgMajor("pg_dump (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+1)")).toBe(16);
    expect(parsePgMajor("pg_dump (PostgreSQL) 17beta1")).toBe(17);
    expect(parsePgMajor("pg_dump (PostgreSQL) 9.6.24")).toBe(96);
    expect(parsePgMajor("garbage")).toBeNull();
  });

  it("maps DATABASE_URL to libpq env without the prisma schema param or the password in argv", () => {
    const env = pgEnvFromUrl("postgresql://us%40er:p%2Fw@host:6543/mydb?schema=public&sslmode=require");
    expect(env).toEqual({ PGHOST: "host", PGPORT: "6543", PGUSER: "us@er", PGPASSWORD: "p/w", PGDATABASE: "mydb", PGSSLMODE: "require" });
  });

  it("strips urls and secrets from error text", () => {
    const text = sanitizeError(`could not connect to ${DB_URL} using s3cretpw and ${PASSPHRASE}`, ["s3cretpw", PASSPHRASE]);
    expect(text).not.toContain("s3cretpw");
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain(PASSPHRASE);
  });
});

describe("backup-db job", () => {
  it("dumps, encrypts, uploads under the dated key, and records success", async () => {
    const h = harness();
    const result = await runBackupDb(h.deps);
    const key = "backups/staging/2026/10/06/alinstra-staging-2026-10-06T07-30-00Z.dump.enc";
    expect(result).toMatchObject({ status: "success", key });
    expect(result.bytes).toBe(h.uploads.get(key)?.length);
    expect(h.records).toEqual([result]);
    expect(h.notices).toHaveLength(0);
    const file = h.uploads.get(key) as Buffer;
    expect(file.subarray(0, 5).toString()).toBe("ALBK1");
    expect(file.includes(Buffer.from("PGDMP"))).toBe(false);
    expect(await decryptUpload(file)).toBe("PGDMP fake custom-format archive");
  });

  it("deletes only .dump.enc objects older than 30 days, under its own environment prefix", async () => {
    const h = harness();
    h.stored.push(
      { key: "backups/staging/2026/09/01/alinstra-staging-old.dump.enc", size: 1, lastModified: new Date(NOW.getTime() - 31 * DAY) },
      { key: "backups/staging/2026/09/20/alinstra-staging-recent.dump.enc", size: 1, lastModified: new Date(NOW.getTime() - 29 * DAY) },
      { key: "backups/staging/2026/09/01/notes.txt", size: 1, lastModified: new Date(NOW.getTime() - 90 * DAY) },
      { key: "backups/production/2026/08/01/alinstra-production-old.dump.enc", size: 1, lastModified: new Date(NOW.getTime() - 90 * DAY) },
    );
    await runBackupDb(h.deps);
    expect(h.deleted).toEqual(["backups/staging/2026/09/01/alinstra-staging-old.dump.enc"]);
  });

  it("a retention failure does not fail the backup", async () => {
    const h = harness();
    h.deps.storage = { ...h.deps.storage, list: async () => Promise.reject(new Error("list denied")) };
    const result = await runBackupDb(h.deps);
    expect(result.status).toBe("success");
    expect(logged.some((entry) => entry.message === "backup retention sweep failed")).toBe(true);
  });

  it("without a passphrase: records not_configured, notifies once, and never throws", async () => {
    let claims = 0;
    const h = harness({
      passphrase: "",
      claimDailyNotice: async () => {
        claims += 1;
        return claims === 1;
      },
    });
    await expect(runBackupDb(h.deps)).resolves.toMatchObject({ status: "not_configured", key: null });
    await expect(runBackupDb(h.deps)).resolves.toMatchObject({ status: "not_configured" });
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]?.subject).toBe("Backups are not configured");
    expect(h.uploads.size).toBe(0);
    expect(h.records.every((r) => r.status === "not_configured")).toBe(true);
  });

  it("still does not throw when the notice or status write itself fails", async () => {
    const h = harness({
      passphrase: " ",
      claimDailyNotice: async () => Promise.reject(new Error("redis down")),
      record: async () => Promise.reject(new Error("db down")),
    });
    await expect(runBackupDb(h.deps)).resolves.toMatchObject({ status: "not_configured" });
  });

  it("fails clearly when pg_dump is older than the server, before dumping anything", async () => {
    const startDump = vi.fn();
    const h = harness({ pgDumpMajor: async () => 15, serverMajor: async () => 16, startDump });
    await expect(runBackupDb(h.deps)).rejects.toThrow(/pg_dump 15 is older than the database server 16/);
    expect(startDump).not.toHaveBeenCalled();
    expect(h.records[0]).toMatchObject({ status: "failed", bytes: 0, key: null });
    expect(h.notices[0]?.subject).toBe("Nightly backup failed");
  });

  it("accepts a pg_dump newer than the server", async () => {
    const h = harness({ pgDumpMajor: async () => 17, serverMajor: async () => 16 });
    await expect(runBackupDb(h.deps)).resolves.toMatchObject({ status: "success" });
  });

  it("on pg_dump failure: records failed, notifies, throws, uploads nothing, leaves no secrets anywhere", async () => {
    const h = harness({}, new BackupFailedError(`pg_dump failed (exit 1): connection to ${DB_URL} refused for s3cretpw`));
    const error = await runBackupDb(h.deps).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(BackupFailedError);
    expect(h.uploads.size).toBe(0);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]?.status).toBe("failed");
    expect(h.notices).toHaveLength(1);
    const everything = JSON.stringify([(error as Error).message, h.records, h.notices, logged]);
    expect(everything).not.toContain("s3cretpw");
    expect(everything).not.toContain(PASSPHRASE);
    expect(everything).not.toContain("postgresql://");
  });

  it("on upload failure: records failed and notifies, with no success record", async () => {
    const h = harness();
    h.deps.storage = { ...h.deps.storage, putFile: async () => Promise.reject(new Error("R2 unreachable")) };
    await expect(runBackupDb(h.deps)).rejects.toThrow(/R2 unreachable/);
    expect(h.records.map((r) => r.status)).toEqual(["failed"]);
    expect(h.notices).toHaveLength(1);
  });

  it("removes its temp files, success or failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "alinstra-backup-root-"));
    try {
      await runBackupDb(harness({ tempDir: root }).deps);
      await runBackupDb(harness({ tempDir: root }, new BackupFailedError("pg_dump failed")).deps).catch(() => undefined);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
