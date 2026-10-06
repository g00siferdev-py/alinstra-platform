import { execFile, execFileSync, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Importing the job also loads .env (through @alinstra/db), the same way the other suites find DATABASE_URL.
import { createBackupDecryptStream } from "@alinstra/crypto";
import { backupKeyFor, installedPgDumpMajor, parsePgMajor, pgEnvFromUrl, runBackupDb, startPgDump, type BackupDeps } from "./backup";

const execFileAsync = promisify(execFile);

function haveTool(name: string): boolean {
  try {
    execFileSync(name, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Skipped (not failed) on machines without the PostgreSQL client tools. CI installs postgresql-client.
const available = haveTool("pg_dump") && haveTool("pg_restore") && haveTool("psql") && Boolean(process.env.DATABASE_URL);

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function psql(url: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync("psql", ["-v", "ON_ERROR_STOP=1", "-qtAX", "-F", "|", "-c", sql], {
    env: { ...process.env, ...pgEnvFromUrl(url) },
  });
  return stdout.trim();
}

/** `table|row count` for every public table, as one sorted string. */
async function rowCounts(url: string): Promise<string> {
  return psql(
    url,
    `select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
     from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
}

function pgRestore(url: string, dumpPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The dump goes in on stdin, so this also works when the client tools run somewhere that cannot see the file.
    const child = spawn("pg_restore", ["--no-owner", "--clean", "--if-exists", "--exit-on-error", `--dbname=${pgEnvFromUrl(url).PGDATABASE}`], {
      env: { ...process.env, ...pgEnvFromUrl(url) },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_restore exited ${code}: ${stderr.slice(0, 500)}`))));
    createReadStream(dumpPath).pipe(child.stdin);
  });
}

describe.skipIf(!available)("backup restore drill (needs pg_dump, pg_restore, psql)", () => {
  const suffix = randomBytes(4).toString("hex");
  const sourceName = `alinstra_drill_src_${suffix}`;
  const restoredName = `alinstra_drill_dst_${suffix}`;
  const passphrase = `drill-passphrase-${suffix}-long-enough`;
  const uploads = new Map<string, string>();
  let adminUrl = "";
  let sourceUrl = "";
  let restoredUrl = "";
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "alinstra-drill-"));
    // Same rule as the rest of the suite: never touch the dev database, only its `_test` sibling.
    const configured = process.env.DATABASE_URL as string;
    const configuredName = decodeURIComponent(new URL(configured).pathname.replace(/^\//, ""));
    adminUrl = urlFor(configured, configuredName.endsWith("_test") ? configuredName : `${configuredName}_test`);
    sourceUrl = urlFor(adminUrl, sourceName);
    restoredUrl = urlFor(adminUrl, restoredName);
    await psql(adminUrl, `create database ${sourceName}`);
    await psql(adminUrl, `create database ${restoredName}`);
    await psql(
      sourceUrl,
      `create table clients (id serial primary key, name text not null, notes jsonb);
       create table blobs (id serial primary key, data bytea not null);
       create table empty_table (id int);
       create index clients_name_idx on clients (name);
       insert into clients (name, notes) select 'Café ' || g, jsonb_build_object('n', g, 'text', 'ünïcode ✓') from generate_series(1, 250) g;
       insert into blobs (data) select decode(md5(g::text), 'hex') from generate_series(1, 40) g`,
    );
  }, 60_000);

  afterAll(async () => {
    for (const name of [sourceName, restoredName]) {
      await psql(adminUrl, `drop database if exists ${name} with (force)`).catch(() => undefined);
    }
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  function deps(overrides: Partial<BackupDeps> = {}): BackupDeps {
    return {
      passphrase,
      appEnv: "drill",
      databaseUrl: sourceUrl,
      storage: {
        putFile: async (key, path) => {
          const copy = join(workDir, `upload-${uploads.size}.enc`);
          await writeFile(copy, await readFile(path));
          uploads.set(key, copy);
        },
        list: async () => [],
        delete: async () => undefined,
      },
      pgDumpMajor: installedPgDumpMajor,
      serverMajor: async () => {
        const version = await psql(sourceUrl, "show server_version_num");
        return Math.floor(Number(version) / 10000);
      },
      startDump: startPgDump,
      record: async () => undefined,
      notify: async () => undefined,
      claimDailyNotice: async () => true,
      now: () => new Date(),
      ...overrides,
    };
  }

  it("has a pg_dump this suite can parse", async () => {
    const { stdout } = await execFileAsync("pg_dump", ["--version"]);
    expect(parsePgMajor(stdout)).toBeGreaterThanOrEqual(14);
  });

  it("dumps, encrypts, decrypts, restores into a scratch database, and the row counts match", async () => {
    const result = await runBackupDb(deps());
    expect(result.status).toBe("success");
    expect(result.key).toMatch(/^backups\/drill\/\d{4}\/\d{2}\/\d{2}\/alinstra-drill-.+\.dump\.enc$/);
    const encrypted = uploads.get(result.key as string) as string;
    expect(result.bytes).toBe((await readFile(encrypted)).length);
    expect((await readFile(encrypted)).subarray(0, 5).toString()).toBe("ALBK1");

    const decrypted = join(workDir, "restored.dump");
    await pipeline(createReadStream(encrypted), createBackupDecryptStream(passphrase), createWriteStream(decrypted));
    // pg_dump custom format starts with the PGDMP magic; the encrypted file must not.
    expect((await readFile(decrypted)).subarray(0, 5).toString()).toBe("PGDMP");
    expect((await readFile(encrypted)).includes(Buffer.from("PGDMP"))).toBe(false);

    await pgRestore(restoredUrl, decrypted);

    const before = await rowCounts(sourceUrl);
    const after = await rowCounts(restoredUrl);
    expect(before).toBe("blobs=40\nclients=250\nempty_table=0");
    expect(after).toBe(before);
    const checksum = "select md5(string_agg(name || notes::text, ',' order by id)) from clients";
    expect(await psql(restoredUrl, checksum)).toBe(await psql(sourceUrl, checksum));
  }, 120_000);

  it("a tampered upload cannot be decrypted, so it can never be restored", async () => {
    await runBackupDb(deps());
    const [, encrypted] = [...uploads.entries()].at(-1) as [string, string];
    const bytes = await readFile(encrypted);
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = (bytes[middle] ?? 0) ^ 0x01;
    const tampered = join(workDir, "tampered.enc");
    await writeFile(tampered, bytes);
    await expect(pipeline(createReadStream(tampered), createBackupDecryptStream(passphrase), createWriteStream(join(workDir, "tampered.dump")))).rejects.toThrow(/authentication failed/);
  }, 120_000);

  it("a failing pg_dump (unreachable database) records failure and uploads nothing", async () => {
    const before = uploads.size;
    const missing = urlFor(adminUrl, `alinstra_drill_missing_${suffix}`);
    const result = await runBackupDb(deps({ databaseUrl: missing })).catch((error: unknown) => error as Error);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/pg_dump failed/);
    expect((result as Error).message).not.toContain(new URL(adminUrl).password || "\u0000");
    expect(uploads.size).toBe(before);
  }, 60_000);

  it("uses the dated key layout", () => {
    expect(backupKeyFor("drill", new Date("2026-01-02T03:04:05Z"))).toBe("backups/drill/2026/01/02/alinstra-drill-2026-01-02T03-04-05Z.dump.enc");
  });
});
