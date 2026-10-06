import { decryptString, encryptStringWithKey, loadKeyring } from "@alinstra/crypto";
import { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { containsPhone, maskPhoneDisplay, maskPhonesIn, open, protectPayload, SEALED_KEY, seal, sealJson } from "./cipher";

/**
 * Operational jobs behind `scripts/encrypt-backfill.ts` and `scripts/rotate-encryption-key.ts`.
 * Both are idempotent, resumable (id-ordered batches, optimistic per-row updates), and safe to run while the
 * app is live. They report counts only; no plaintext, ciphertext, or row id is ever logged.
 */

export type JobLog = (line: string) => void;

type Row = Record<string, unknown> & { id: string };
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

function delegate(model: string): Delegate {
  return (prisma as unknown as Record<string, Delegate>)[model] as Delegate;
}

/** Every column that holds AES-GCM ciphertext. Rotation walks all of these. */
export const CIPHER_COLUMNS = [
  { table: "call_record", model: "callRecord", field: "transcriptCipher", touchUpdatedAt: true },
  { table: "call_record", model: "callRecord", field: "summaryCipher", touchUpdatedAt: true },
  { table: "call_record", model: "callRecord", field: "rawEventsCipher", touchUpdatedAt: true },
  { table: "call_record", model: "callRecord", field: "callerE164Cipher", touchUpdatedAt: true },
  { table: "client_message", model: "clientMessage", field: "callerNameCipher", touchUpdatedAt: false },
  { table: "client_message", model: "clientMessage", field: "callbackNumberCipher", touchUpdatedAt: false },
  { table: "client_message", model: "clientMessage", field: "bodyCipher", touchUpdatedAt: false },
  { table: "transfer_target", model: "transferTarget", field: "e164Cipher", touchUpdatedAt: false },
  { table: "knowledge_base", model: "knowledgeBase", field: "staffCipher", touchUpdatedAt: true },
  { table: "knowledge_document", model: "knowledgeDocument", field: "extractedTextCipher", touchUpdatedAt: true },
  { table: "invite", model: "invite", field: "tokenCipher", touchUpdatedAt: false },
] as const;

export type CipherColumn = (typeof CIPHER_COLUMNS)[number];

export const DEFAULT_BATCH = 500;

export function parseBatch(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BATCH;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error("--batch must be an integer from 1 to 5000");
  return n;
}

// ---------------------------------------------------------------------------
// Key-id counts
// ---------------------------------------------------------------------------

export type KeyCounts = { keys: Record<string, number>; legacyV1: number; unreadable: number; total: number };

/** Counts payloads per key id for one column, in SQL. `legacyV1` is the subset of `k1` still in the v1 format. */
export async function keyCounts(column: CipherColumn): Promise<KeyCounts> {
  // Table and column names come from the constant registry above, never from input.
  const rows = await prisma.$queryRawUnsafe<Array<{ kid: string; legacy: boolean; n: number }>>(
    `SELECT CASE WHEN "${column.field}" LIKE 'v1.%' THEN 'k1'
                 WHEN "${column.field}" ~ '^v2\\.k[0-9]+\\.' THEN split_part("${column.field}", '.', 2)
                 ELSE 'unknown' END AS kid,
            ("${column.field}" LIKE 'v1.%') AS legacy,
            count(*)::int AS n
       FROM "${column.table}" WHERE "${column.field}" IS NOT NULL GROUP BY 1, 2`,
  );
  const out: KeyCounts = { keys: {}, legacyV1: 0, unreadable: 0, total: 0 };
  for (const row of rows) {
    out.total += row.n;
    if (row.kid === "unknown") out.unreadable += row.n;
    else out.keys[row.kid] = (out.keys[row.kid] ?? 0) + row.n;
    if (row.legacy) out.legacyV1 += row.n;
  }
  return out;
}

export function formatKeyCounts(counts: KeyCounts): string {
  const keys = Object.entries(counts.keys).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  const parts = keys.length === 0 ? ["none"] : keys.map(([id, n]) => `${id}=${n}`);
  if (counts.legacyV1 > 0) parts.push(`(v1 format: ${counts.legacyV1})`);
  if (counts.unreadable > 0) parts.push(`unrecognized=${counts.unreadable}`);
  return parts.join(" ");
}

export async function allKeyCounts(): Promise<Array<{ column: CipherColumn; counts: KeyCounts }>> {
  const out: Array<{ column: CipherColumn; counts: KeyCounts }> = [];
  for (const column of CIPHER_COLUMNS) out.push({ column, counts: await keyCounts(column) });
  return out;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export type RotationResult = {
  to: string;
  dryRun: boolean;
  /** Per column: rows moved (or that would move), skipped because a concurrent write changed them, unreadable. */
  columns: Array<{ column: string; moved: number; raced: number; failed: number }>;
  failed: number;
  before: Array<{ column: string; counts: KeyCounts }>;
  after: Array<{ column: string; counts: KeyCounts }>;
};

function columnName(column: CipherColumn): string {
  return `${column.table}.${column.field}`;
}

/**
 * Re-encrypts every cipher column under `to` (`k2`). Only rows not already under `to` are touched, so a
 * re-run after an interruption, or a second run, does zero work. A row whose payload cannot be decrypted is
 * counted as failed and left alone.
 */
export async function rotateEncryptionKey(options: { to: string; dryRun?: boolean; batch?: number; log?: JobLog }): Promise<RotationResult> {
  const log = options.log ?? (() => undefined);
  const dryRun = options.dryRun ?? false;
  const batch = options.batch ?? DEFAULT_BATCH;
  const ring = loadKeyring();
  if (!/^k[1-9]\d*$/.test(options.to)) throw new Error(`--to must look like k2, got "${options.to}"`);
  if (!ring.keys.has(options.to)) throw new Error(`Key ${options.to} is not configured; set ENCRYPTION_KEY_V${options.to.slice(1)} first`);
  if (ring.activeId !== options.to) {
    log(`warning: ENCRYPTION_ACTIVE_KEY is ${ring.activeId}, not ${options.to}; new writes keep landing on ${ring.activeId}. Deploy ENCRYPTION_ACTIVE_KEY=${options.to.slice(1)} first.`);
  }

  const before = await allKeyCounts();
  log(`Payloads by key before${dryRun ? " (dry run)" : ""}:`);
  for (const entry of before) log(`  ${columnName(entry.column).padEnd(38)} ${formatKeyCounts(entry.counts)}`);

  const prefix = `v2.${options.to}.`;
  const result: RotationResult = { to: options.to, dryRun, columns: [], failed: 0, before: before.map((e) => ({ column: columnName(e.column), counts: e.counts })), after: [] };
  for (const column of CIPHER_COLUMNS) {
    const model = delegate(column.model);
    const stats = { column: columnName(column), moved: 0, raced: 0, failed: 0 };
    let cursor: string | undefined;
    for (;;) {
      const rows = await model.findMany({
        where: { [column.field]: { not: null }, NOT: { [column.field]: { startsWith: prefix } }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: batch,
        select: { id: true, [column.field]: true, ...(column.touchUpdatedAt ? { updatedAt: true } : {}) },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const current = row[column.field] as string;
        let next: string;
        try {
          next = encryptStringWithKey(decryptString(current), options.to);
        } catch {
          stats.failed += 1;
          continue;
        }
        if (dryRun) {
          stats.moved += 1;
          continue;
        }
        // Optimistic: only replace the exact payload we read, so a concurrent write is never clobbered.
        const updated = await model.updateMany({
          where: { id: row.id, [column.field]: current },
          data: { [column.field]: next, ...(column.touchUpdatedAt ? { updatedAt: row.updatedAt } : {}) },
        });
        if (updated.count === 1) stats.moved += 1;
        else stats.raced += 1;
      }
      cursor = rows[rows.length - 1]?.id;
      if (rows.length < batch) break;
    }
    result.columns.push(stats);
    result.failed += stats.failed;
    log(`  ${stats.column.padEnd(38)} ${dryRun ? "would move" : "moved"} ${stats.moved}${stats.raced ? `, raced ${stats.raced} (re-run)` : ""}${stats.failed ? `, UNREADABLE ${stats.failed}` : ""}`);
  }

  const after = await allKeyCounts();
  result.after = after.map((e) => ({ column: columnName(e.column), counts: e.counts }));
  log(`Payloads by key after${dryRun ? " (dry run, nothing written)" : ""}:`);
  for (const entry of after) log(`  ${columnName(entry.column).padEnd(38)} ${formatKeyCounts(entry.counts)}`);
  return result;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export type BackfillColumnResult = { column: string; candidates: number; written: number; raced: number };
export type BackfillResult = { dryRun: boolean; columns: BackfillColumnResult[]; remaining: Array<{ column: string; rows: number }> };

type Counter = { candidates: number; written: number; raced: number };

/** Walks id-ordered batches of rows matching `where`; `handle` returns true when it wrote (or would write). */
async function walk(
  model: Delegate,
  where: Record<string, unknown>,
  select: Record<string, true>,
  batch: number,
  handle: (row: Row) => Promise<"written" | "raced" | "skipped">,
): Promise<Counter> {
  const counter: Counter = { candidates: 0, written: 0, raced: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await model.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: batch, select: { id: true, ...select } });
    if (rows.length === 0) break;
    for (const row of rows) {
      counter.candidates += 1;
      const outcome = await handle(row);
      if (outcome === "written") counter.written += 1;
      if (outcome === "raced") counter.raced += 1;
    }
    cursor = rows[rows.length - 1]?.id;
    if (rows.length < batch) break;
  }
  return counter;
}

const jsonPresent = (field: string) => ({ NOT: { [field]: { equals: Prisma.DbNull } } });

/**
 * Moves plaintext into the cipher columns and redacts phone numbers in JSON logs. Plaintext columns are set to
 * null, not dropped (a later phase drops them). Each row update is conditional on the row still being what we
 * read, so a live write never gets overwritten; a raced row is simply picked up by the next run.
 */
export async function encryptBackfill(options: { dryRun?: boolean; batch?: number; log?: JobLog } = {}): Promise<BackfillResult> {
  const log = options.log ?? (() => undefined);
  const dryRun = options.dryRun ?? false;
  const batch = options.batch ?? DEFAULT_BATCH;
  loadKeyring(); // fail fast on a bad keyring before touching anything
  const columns: BackfillColumnResult[] = [];
  const record = (column: string, counter: Counter) => {
    columns.push({ column, ...counter });
    log(`  ${column.padEnd(38)} ${dryRun ? "would write" : "wrote"} ${counter.written}/${counter.candidates}${counter.raced ? `, raced ${counter.raced} (re-run)` : ""}`);
  };
  log(`Encrypt backfill${dryRun ? " (dry run)" : ""}, batch ${batch}:`);

  // ClientMessage: three plaintext columns plus the masked callback.
  record(
    "client_message (name, callback, body)",
    await walk(
      delegate("clientMessage"),
      { OR: [{ callerName: { not: null } }, { callbackNumber: { not: null } }, { body: { not: null } }] },
      { callerName: true, callbackNumber: true, body: true, callerNameCipher: true, callbackNumberCipher: true, bodyCipher: true, callbackMasked: true },
      batch,
      async (row) => {
        const data: Record<string, unknown> = {};
        const fields = [
          ["callerName", "callerNameCipher"],
          ["callbackNumber", "callbackNumberCipher"],
          ["body", "bodyCipher"],
        ] as const;
        for (const [plain, cipher] of fields) {
          const value = row[plain] as string | null;
          if (value === null) continue;
          // An existing readable cipher wins; otherwise write one from the plaintext.
          if (open(row[cipher] as string | null) === null) data[cipher] = seal(value);
          data[plain] = null;
        }
        const callback = row.callbackNumber as string | null;
        if (callback && !row.callbackMasked) data.callbackMasked = maskPhoneDisplay(callback);
        if (dryRun) return "written";
        const updated = await delegate("clientMessage").updateMany({
          where: { id: row.id, callerName: row.callerName, callbackNumber: row.callbackNumber, body: row.body },
          data,
        });
        return updated.count === 1 ? "written" : "raced";
      },
    ),
  );

  record(
    "transfer_target.e164",
    await walk(delegate("transferTarget"), { e164: { not: null } }, { e164: true, e164Cipher: true, e164Masked: true }, batch, async (row) => {
      const value = row.e164 as string;
      const data: Record<string, unknown> = { e164: null };
      if (open(row.e164Cipher as string | null) === null) data.e164Cipher = seal(value);
      if (!row.e164Masked) data.e164Masked = maskPhoneDisplay(value);
      if (dryRun) return "written";
      const updated = await delegate("transferTarget").updateMany({ where: { id: row.id, e164: value }, data });
      return updated.count === 1 ? "written" : "raced";
    }),
  );

  record(
    "knowledge_base.staff",
    await walk(delegate("knowledgeBase"), jsonPresent("staff"), { staff: true, staffCipher: true, updatedAt: true }, batch, async (row) => {
      if (dryRun) return "written";
      const data: Record<string, unknown> = { staff: Prisma.DbNull, updatedAt: row.updatedAt };
      if (open(row.staffCipher as string | null) === null) data.staffCipher = sealJson(row.staff);
      const updated = await delegate("knowledgeBase").updateMany({ where: { id: row.id, staff: { equals: row.staff as Prisma.InputJsonValue } }, data });
      return updated.count === 1 ? "written" : "raced";
    }),
  );

  record(
    "knowledge_document.extractedText",
    await walk(delegate("knowledgeDocument"), { extractedText: { not: null } }, { extractedText: true, extractedTextCipher: true, updatedAt: true }, batch, async (row) => {
      const value = row.extractedText as string;
      const data: Record<string, unknown> = { extractedText: null, updatedAt: row.updatedAt };
      if (open(row.extractedTextCipher as string | null) === null) data.extractedTextCipher = seal(value);
      if (dryRun) return "written";
      const updated = await delegate("knowledgeDocument").updateMany({ where: { id: row.id, extractedText: value }, data });
      return updated.count === 1 ? "written" : "raced";
    }),
  );

  record("change_log.before/after (phones)", await redactChangeLog(batch, dryRun));
  record("quick_update.payload (phones)", await redactQuickUpdates(batch, dryRun));

  const remaining = await remainingPlaintext();
  log("Plaintext still present after this run:");
  for (const row of remaining) log(`  ${row.column.padEnd(38)} ${row.rows}`);
  return { dryRun, columns, remaining };
}

/** Candidate ids for a JSON column that contain a phone-like run of digits. Postgres does the coarse filter. */
async function jsonCandidateIds(table: string, jsonColumns: string[], afterId: string | null, limit: number, extra = ""): Promise<string[]> {
  const test = jsonColumns.map((c) => `"${c}"::text ~ '[0-9][0-9 ().-]{8,}[0-9]'`).join(" OR ");
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "${table}" WHERE (${test}) ${extra} ${afterId ? `AND "id" > '${afterId.replace(/'/g, "''")}'` : ""} ORDER BY "id" ASC LIMIT ${Math.trunc(limit)}`,
  );
  return rows.map((row) => row.id);
}

async function redactChangeLog(batch: number, dryRun: boolean): Promise<Counter> {
  const counter: Counter = { candidates: 0, written: 0, raced: 0 };
  let cursor: string | null = null;
  for (;;) {
    const ids = await jsonCandidateIds("change_log", ["before", "after"], cursor, batch);
    if (ids.length === 0) break;
    const rows = await prisma.changeLog.findMany({ where: { id: { in: ids } }, select: { id: true, before: true, after: true }, orderBy: { id: "asc" } });
    for (const row of rows) {
      counter.candidates += 1;
      const beforeHit = row.before !== null && containsPhone(row.before);
      const afterHit = row.after !== null && containsPhone(row.after);
      if (!beforeHit && !afterHit) continue; // coarse match was not a phone (an id, an amount): nothing to do
      if (dryRun) {
        counter.written += 1;
        continue;
      }
      const updated = await prisma.changeLog.updateMany({
        where: { id: row.id, ...(beforeHit ? { before: { equals: row.before as Prisma.InputJsonValue } } : {}), ...(afterHit ? { after: { equals: row.after as Prisma.InputJsonValue } } : {}) },
        data: { ...(beforeHit ? { before: maskPhonesIn(row.before) as Prisma.InputJsonValue } : {}), ...(afterHit ? { after: maskPhonesIn(row.after) as Prisma.InputJsonValue } : {}) },
      });
      if (updated.count === 1) counter.written += 1;
      else counter.raced += 1;
    }
    cursor = ids[ids.length - 1] ?? null;
    if (ids.length < batch) break;
  }
  return counter;
}

async function redactQuickUpdates(batch: number, dryRun: boolean): Promise<Counter> {
  const counter: Counter = { candidates: 0, written: 0, raced: 0 };
  let cursor: string | null = null;
  // Rows already carrying a sealed original were redacted by the app or an earlier run.
  const notSealed = `AND position('"${SEALED_KEY}"' in "payload"::text) = 0`;
  for (;;) {
    const ids = await jsonCandidateIds("quick_update", ["payload"], cursor, batch, notSealed);
    if (ids.length === 0) break;
    const rows = await prisma.quickUpdate.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, payload: true }, orderBy: { id: "asc" } });
    for (const row of rows) {
      counter.candidates += 1;
      if (!containsPhone(row.payload)) continue;
      if (dryRun) {
        counter.written += 1;
        continue;
      }
      // A held update is applied later from its payload, so its original is kept encrypted beside the masked copy.
      const next = row.status === "held" ? protectPayload(row.payload) : maskPhonesIn(row.payload);
      const updated = await prisma.quickUpdate.updateMany({
        where: { id: row.id, payload: { equals: row.payload as Prisma.InputJsonValue } },
        data: { payload: next as Prisma.InputJsonValue },
      });
      if (updated.count === 1) counter.written += 1;
      else counter.raced += 1;
    }
    cursor = ids[ids.length - 1] ?? null;
    if (ids.length < batch) break;
  }
  return counter;
}

/** Rows that still hold plaintext in a column that has a cipher twin. Zero everywhere means the plaintext columns can go. */
export async function remainingPlaintext(): Promise<Array<{ column: string; rows: number }>> {
  const [messages, targets, staff, docs] = await Promise.all([
    prisma.clientMessage.count({ where: { OR: [{ callerName: { not: null } }, { callbackNumber: { not: null } }, { body: { not: null } }] } }),
    prisma.transferTarget.count({ where: { e164: { not: null } } }),
    prisma.knowledgeBase.count({ where: jsonPresent("staff") }),
    prisma.knowledgeDocument.count({ where: { extractedText: { not: null } } }),
  ]);
  return [
    { column: "client_message (name, callback, body)", rows: messages },
    { column: "transfer_target.e164", rows: targets },
    { column: "knowledge_base.staff", rows: staff },
    { column: "knowledge_document.extractedText", rows: docs },
  ];
}
