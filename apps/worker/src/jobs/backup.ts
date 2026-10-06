import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { getEnv, log } from "@alinstra/config";
import { createBackupEncryptStream } from "@alinstra/crypto";
import { postgresServerMajor, recordBackupResult, type BackupRecord } from "@alinstra/db";
import { enqueueSendAdminNotice, getRedis } from "@alinstra/queue";
import { getBackupStorage, type StoredObject } from "@alinstra/storage";

const execFileAsync = promisify(execFile);

/** Backups older than this are deleted after each successful run. */
export const BACKUP_RETENTION_DAYS = 30;
const RETENTION_MS = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const NOT_CONFIGURED_NOTICE_KEY = "backup:not-configured-notice";
const NOT_CONFIGURED_NOTICE_SECONDS = 24 * 60 * 60;
const MAX_ERROR_CHARS = 300;

/** Thrown for any failed run. The message is already sanitised: no URLs, passwords, or passphrases. */
export class BackupFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFailedError";
  }
}

export type DumpProcess = {
  /** pg_dump's custom-format archive, as it is produced. */
  stdout: Readable;
  /** Resolves when pg_dump exits 0; rejects (with a sanitised message) otherwise. Settle only after stdout ends. */
  finished: Promise<void>;
};

export type BackupDeps = {
  passphrase: string;
  /** Environment label used in the object key: `staging`, `production`, ... */
  appEnv: string;
  databaseUrl: string;
  storage: Pick<StoredObject, "putFile" | "list" | "delete">;
  pgDumpMajor: () => Promise<number>;
  serverMajor: () => Promise<number>;
  startDump: (databaseUrl: string) => DumpProcess;
  record: (record: BackupRecord) => Promise<void>;
  notify: (subject: string, text: string) => Promise<void>;
  /** True the first time it is called in a rolling 24h window; used to rate-limit the "not configured" notice. */
  claimDailyNotice: () => Promise<boolean>;
  now: () => Date;
  tempDir?: string;
};

export function backupEnvLabel(raw: string | undefined): string {
  const cleaned = (raw ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "staging";
}

/** `backups/<env>/YYYY/MM/DD/alinstra-<env>-<ISO timestamp>.dump.enc` (UTC; ':' becomes '-' so it is a safe filename everywhere). */
export function backupKeyFor(appEnv: string, at: Date): string {
  const iso = at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `backups/${appEnv}/${year}/${month}/${day}/alinstra-${appEnv}-${iso}.dump.enc`;
}

/** Parses the major version from `pg_dump (PostgreSQL) 16.4 (Debian ...)`, or `17beta1`, or `9.6.24`. */
export function parsePgMajor(output: string): number | null {
  const match = /\(PostgreSQL\)\s+(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return null;
  const first = Number(match[1]);
  // Before 10 the major was two numbers (9.6).
  return first >= 10 ? first : Number(`${first}${match[2] ?? "0"}`);
}

/** libpq settings for pg_dump, passed through the environment so the password never appears in `ps`. */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const out: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  // Prisma-style `?schema=public` is not a libpq option (pg_dump rejects it), so only carry what libpq knows.
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) out.PGSSLMODE = sslmode;
  return out;
}

/** Removes anything that could be a credential from text that may be logged, emailed, or sent to Sentry. */
export function sanitizeError(message: string, secrets: string[]): string {
  let clean = message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]");
  for (const secret of secrets) {
    if (secret.length >= 4) clean = clean.split(secret).join("[redacted]");
  }
  clean = clean.replace(/\s+/g, " ").trim();
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}...` : clean;
}

function databasePasswords(databaseUrl: string): string[] {
  try {
    const url = new URL(databaseUrl);
    return [url.password, decodeURIComponent(url.password)].filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "HOME", "TMPDIR", "TEMP", "LANG"]) {
    const value = process.env[name];
    if (value !== undefined) base[name] = value;
  }
  return { ...base, ...extra };
}

export async function installedPgDumpMajor(): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("pg_dump", ["--version"], { env: childEnv({}), timeout: 15_000 }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BackupFailedError("pg_dump is not installed on the worker; install postgresql-client in the worker image");
    }
    throw new BackupFailedError("pg_dump --version failed");
  }
  const major = parsePgMajor(stdout);
  if (major === null) throw new BackupFailedError("Could not read the pg_dump version");
  return major;
}

export function startPgDump(databaseUrl: string): DumpProcess {
  const secrets = [databaseUrl, ...databasePasswords(databaseUrl)];
  const child = spawn("pg_dump", ["--format=custom", "--no-password"], {
    env: childEnv(pgEnvFromUrl(databaseUrl)),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString("utf8");
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new BackupFailedError(
          error.code === "ENOENT"
            ? "pg_dump is not installed on the worker; install postgresql-client in the worker image"
            : `pg_dump could not start (${error.code ?? "error"})`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new BackupFailedError(`pg_dump failed (${signal ?? `exit ${code}`}): ${sanitizeError(stderr, secrets)}`));
    });
  });
  // The caller awaits `finished` after the pipeline; keep an early rejection from becoming an unhandled one.
  finished.catch(() => undefined);
  return { stdout: child.stdout, finished };
}

async function dumpEncryptedToFile(deps: BackupDeps, outPath: string): Promise<number> {
  const encrypt = await createBackupEncryptStream(deps.passphrase);
  const dump = deps.startDump(deps.databaseUrl);
  try {
    await pipeline(dump.stdout, encrypt, createWriteStream(outPath, { mode: 0o600 }));
  } catch (error) {
    // A pg_dump failure closes stdout early; prefer its explanation over the generic stream error.
    await dump.finished;
    throw error;
  }
  await dump.finished;
  return (await stat(outPath)).size;
}

async function deleteExpired(deps: BackupDeps, now: Date): Promise<number> {
  const cutoff = now.getTime() - RETENTION_MS;
  const objects = await deps.storage.list(`backups/${deps.appEnv}/`);
  let removed = 0;
  for (const object of objects) {
    if (!object.key.endsWith(".dump.enc") || object.lastModified.getTime() >= cutoff) continue;
    await deps.storage.delete(object.key);
    removed += 1;
  }
  return removed;
}

async function safely(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    log("error", label, { error: error instanceof Error ? error.name : "unknown" });
  }
}

export function backupDeps(): BackupDeps {
  const env = getEnv();
  return {
    passphrase: env.BACKUP_PASSPHRASE,
    appEnv: backupEnvLabel(env.APP_ENV),
    databaseUrl: env.DATABASE_URL,
    storage: getBackupStorage(),
    pgDumpMajor: installedPgDumpMajor,
    serverMajor: postgresServerMajor,
    startDump: startPgDump,
    record: recordBackupResult,
    notify: (subject, text) => enqueueSendAdminNotice({ subject, text }),
    claimDailyNotice: async () =>
      (await getRedis().set(NOT_CONFIGURED_NOTICE_KEY, "1", "EX", NOT_CONFIGURED_NOTICE_SECONDS, "NX")) === "OK",
    now: () => new Date(),
  };
}

/**
 * Nightly encrypted backup: pg_dump (custom format) -> AES-256-GCM stream -> temp file -> R2 -> retention sweep.
 * The plaintext dump never touches disk; only the encrypted file does, and it is removed afterwards.
 *
 * - No passphrase: records `not_configured`, logs and sends one admin notice per day, returns. Never throws.
 * - Any failure: records `failed`, sends an admin notice, then throws `BackupFailedError` so the worker's
 *   failed-job handler reports it to Sentry. Neither carries a URL, password, or passphrase.
 */
export async function runBackupDb(deps: BackupDeps = backupDeps()): Promise<BackupRecord> {
  const startedAt = deps.now();

  if (!deps.passphrase.trim()) {
    const record: BackupRecord = { at: startedAt.toISOString(), bytes: 0, key: null, status: "not_configured", error: "BACKUP_PASSPHRASE is not set on the worker" };
    log("warn", "backups are not configured", { appEnv: deps.appEnv });
    await safely("backup status record failed", () => deps.record(record));
    await safely("backup notice failed", async () => {
      if (await deps.claimDailyNotice()) {
        await deps.notify(
          "Backups are not configured",
          `Nightly database backups are not running for ${deps.appEnv}: BACKUP_PASSPHRASE is not set on the worker. Set it in Railway (worker service only) and redeploy. See docs/RESTORE.md.`,
        );
      }
    });
    return record;
  }

  const secrets = [deps.passphrase, deps.databaseUrl, ...databasePasswords(deps.databaseUrl)];
  const key = backupKeyFor(deps.appEnv, startedAt);
  let dir: string | undefined;
  try {
    const [client, server] = await Promise.all([deps.pgDumpMajor(), deps.serverMajor()]);
    if (client < server) {
      throw new BackupFailedError(
        `pg_dump ${client} is older than the database server ${server}; install postgresql-client-${server} in the worker image (see apps/worker/Dockerfile PG_MAJOR)`,
      );
    }

    dir = await mkdtemp(join(deps.tempDir ?? tmpdir(), "alinstra-backup-"));
    const file = join(dir, "backup.dump.enc");
    const bytes = await dumpEncryptedToFile(deps, file);
    await deps.storage.putFile(key, file, bytes, "application/octet-stream");

    const record: BackupRecord = { at: deps.now().toISOString(), bytes, key, status: "success" };
    await safely("backup status record failed", () => deps.record(record));
    log("info", "database backup uploaded", { appEnv: deps.appEnv, key, bytes, pgDump: client, server });

    await safely("backup retention sweep failed", async () => {
      const removed = await deleteExpired(deps, deps.now());
      if (removed > 0) log("info", "old backups deleted", { removed, retentionDays: BACKUP_RETENTION_DAYS });
    });
    return record;
  } catch (error) {
    const message = sanitizeError(error instanceof BackupFailedError ? error.message : `${error instanceof Error ? error.name : "Error"}: ${error instanceof Error ? error.message : "unknown"}`, secrets);
    const record: BackupRecord = { at: deps.now().toISOString(), bytes: 0, key: null, status: "failed", error: message };
    log("error", "database backup failed", { appEnv: deps.appEnv, error: message });
    await safely("backup status record failed", () => deps.record(record));
    await safely("backup notice failed", () =>
      deps.notify("Nightly backup failed", `The nightly database backup for ${deps.appEnv} failed at ${record.at}.\n\nReason: ${message}\n\nThe previous backups are untouched. Check the worker logs.`),
    );
    throw new BackupFailedError(message);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
