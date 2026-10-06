import { open as openCipher, readField, seal as sealCipher } from "./cipher";
import { callFlags, parseCallFlags, type CallFlag } from "./call-flags";
import {
  costCentsOf,
  deriveOutcome,
  durationSecondsOf,
  normalizeSentiment,
  RETELL_CALL_EVENTS,
  transcriptFromCall,
  type CallOutcome,
  type CallTranscript,
  type CallTurn,
  type RetellCallEvent,
} from "./call-transcript";
import { recordChange, type Actor } from "./changes";
import { prisma } from "./client";
import { CALL_RETENTION_DEFAULT_DAYS, CALL_RETENTION_MAX_DAYS, CALL_RETENTION_MIN_DAYS, maskCaller } from "./domain";
import { Prisma, type Prisma as PrismaTypes } from "./generated/prisma/client";
import { assertTenantContext, type TenantContext } from "./tenant";

const WEBHOOK_ACTOR: Actor = { id: "provider-webhook", role: "admin" };
const PURGE_ACTOR: Actor = { id: "retention-purge", role: "admin" };

export const RECORDING_STATUSES = ["none", "pending", "stored", "failed", "purged"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const CALL_RETENTION_LIMITS = { min: CALL_RETENTION_MIN_DAYS, max: CALL_RETENTION_MAX_DAYS, default: CALL_RETENTION_DEFAULT_DAYS } as const;
/** Archived clients lose everything this long after service ends, whatever their retention setting. */
export const ARCHIVED_PURGE_GRACE_DAYS = 30;

// Call data is sealed with the @alinstra/crypto keyring (v2 payloads, active key); the keyring is read from
// env on every call, so tests can swap keys and rotation needs no restart.
function seal(value: string): string {
  const sealed = sealCipher(value);
  if (sealed === null) throw new Error("Cannot seal an empty value");
  return sealed;
}

const open = openCipher;

function parseTranscript(cipher: string | null): CallTranscript | null {
  const text = open(cipher);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as CallTranscript;
    return parsed && Array.isArray(parsed.turns) ? parsed : null;
  } catch {
    return null;
  }
}

function parseRawEvents(cipher: string | null): unknown[] {
  const text = open(cipher);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Applies one Retell webhook event. Idempotent by `retellCallId`; events may repeat or arrive out of
 * order (`call_analyzed` before `call_ended` on short calls), so every field is merged with "keep what we
 * have unless the event carries it". Returns whether a recording job should be queued: true only on the
 * transition `none → pending`, so duplicates never enqueue twice.
 */
export async function applyRetellCall(payload: RetellCallEvent): Promise<{ recordingQueued: boolean; callRecordId: string | null }> {
  const call = payload.call;
  const event = payload.event ?? "";
  if (!call?.call_id || !(RETELL_CALL_EVENTS as readonly string[]).includes(event)) return { recordingQueued: false, callRecordId: null };
  const client = await prisma.client.findFirst({
    where: {
      archivedAt: null,
      OR: [
        ...(call.agent_id ? [{ retellAgentId: call.agent_id }] : []),
        ...(call.to_number ? [{ phoneE164: call.to_number }] : []),
      ],
    },
    select: { id: true, name: true },
  });
  if (!client) return { recordingQueued: false, callRecordId: null };
  const callId = call.call_id;
  const startedAt = typeof call.start_timestamp === "number" ? new Date(call.start_timestamp) : null;
  const ended = event !== "call_started";
  const endedAt = ended && typeof call.end_timestamp === "number" ? new Date(call.end_timestamp) : null;
  const durationSeconds = ended ? durationSecondsOf(call) : null;
  const transcript = ended ? transcriptFromCall(call) : null;
  const analysis = call.call_analysis;
  const hasRecording = typeof call.recording_url === "string" && call.recording_url.length > 0;
  const fromNumber = (call.from_number ?? "").trim();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.callRecord.findUnique({ where: { retellCallId: callId } });
    const rawEvents = parseRawEvents(existing?.rawEventsCipher ?? null);
    const alreadySeen = rawEvents.some((row) => (row as { event?: string }).event === event);
    if (!alreadySeen) rawEvents.push(sanitizeEvent(payload));
    const turns: CallTurn[] = transcript?.turns ?? parseTranscript(existing?.transcriptCipher ?? null)?.turns ?? [];
    const outcome: CallOutcome | null = ended || existing?.endedAt ? deriveOutcome(turns, { disconnection_reason: call.disconnection_reason ?? existing?.endReason ?? undefined }) : null;
    const purged = Boolean(existing?.purgedAt);
    const recordingQueued = !purged && hasRecording && (existing?.recordingStatus ?? "none") === "none";
    const mergedDuration = existing?.durationSeconds ?? durationSeconds;
    const mergedSentiment = normalizeSentiment(analysis?.user_sentiment) ?? existing?.sentiment ?? null;
    const mergedEndReason = (ended ? call.disconnection_reason : undefined) ?? existing?.endReason ?? null;
    const shouldFlag = !purged && ended && (turns.length > 0 || Boolean(mergedSentiment));
    const computedFlags: CallFlag[] = shouldFlag
      ? callFlags(turns, {
          durationSeconds: mergedDuration,
          sentiment: mergedSentiment,
          endReason: mergedEndReason,
        })
      : [];

    const data: PrismaTypes.CallRecordUncheckedUpdateInput & PrismaTypes.CallRecordUncheckedCreateInput = {
      clientId: client.id,
      retellCallId: callId,
      startedAt: existing?.startedAt ?? startedAt,
      endedAt: existing?.endedAt ?? endedAt,
      durationSeconds: mergedDuration,
      callerMasked: existing?.callerMasked || maskCaller(fromNumber),
      callerE164Cipher: purged ? null : existing?.callerE164Cipher ?? (fromNumber ? seal(fromNumber) : null),
      endReason: mergedEndReason,
      transcriptCipher: purged ? null : transcript ? seal(JSON.stringify(transcript)) : existing?.transcriptCipher ?? null,
      summaryCipher: purged ? null : analysis?.call_summary ? seal(analysis.call_summary) : existing?.summaryCipher ?? null,
      rawEventsCipher: purged ? null : seal(JSON.stringify(rawEvents)),
      sentiment: mergedSentiment,
      successful: typeof analysis?.call_successful === "boolean" ? analysis.call_successful : existing?.successful ?? null,
      inVoicemail: typeof analysis?.in_voicemail === "boolean" ? analysis.in_voicemail : existing?.inVoicemail ?? null,
      costCents: costCentsOf(call) ?? existing?.costCents ?? null,
      outcome: outcome ?? existing?.outcome ?? null,
      flags: purged ? Prisma.DbNull : shouldFlag ? computedFlags : existing?.flags ?? Prisma.DbNull,
      analyzedAt: event === "call_analyzed" ? existing?.analyzedAt ?? new Date() : existing?.analyzedAt ?? null,
      recordingStatus: recordingQueued ? "pending" : existing?.recordingStatus ?? "none",
    };

    if (!existing) {
      const created = await tx.callRecord.create({ data });
      await recordChange(tx, {
        clientId: client.id,
        actor: WEBHOOK_ACTOR,
        action: "call.recorded",
        entityType: "call_record",
        entityId: created.id,
        summary: `Recorded a call for ${client.name}`,
      });
      return { recordingQueued, callRecordId: created.id };
    }
    await tx.callRecord.update({ where: { id: existing.id }, data });
    return { recordingQueued, callRecordId: existing.id };
  });
}

/** The raw event kept for the admin view, minus the provider recording links (we never store those). */
function sanitizeEvent(payload: RetellCallEvent): unknown {
  const call = { ...(payload.call ?? {}) } as Record<string, unknown>;
  for (const key of Object.keys(call)) {
    if (/recording.*url|public_log_url|knowledge_base_retrieved_contents_url/i.test(key)) delete call[key];
  }
  return { event: payload.event, receivedAt: new Date().toISOString(), call };
}

export function recordingKeyFor(clientId: string, retellCallId: string, contentType: string): string {
  const extension = /mpeg|mp3/i.test(contentType) ? "mp3" : /ogg/i.test(contentType) ? "ogg" : /webm/i.test(contentType) ? "webm" : "wav";
  const safeId = retellCallId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `clients/${clientId}/calls/${safeId}.${extension}`;
}

/** What the worker needs to copy a recording. Null when the call is unknown, purged, or already stored. */
export async function recordingTarget(retellCallId: string): Promise<{ callRecordId: string; clientId: string } | null> {
  const row = await prisma.callRecord.findUnique({ where: { retellCallId }, select: { id: true, clientId: true, recordingStatus: true, purgedAt: true } });
  if (!row || row.purgedAt || row.recordingStatus === "stored" || row.recordingStatus === "purged") return null;
  return { callRecordId: row.id, clientId: row.clientId };
}

export async function markRecordingStored(retellCallId: string, input: { key: string; contentType: string; bytes: number }): Promise<void> {
  await prisma.callRecord.update({
    where: { retellCallId },
    data: { recordingKey: input.key, recordingContentType: input.contentType, recordingBytes: input.bytes, recordingStatus: "stored", recordingError: null },
  });
}

export async function markRecordingFailed(retellCallId: string, error: string): Promise<void> {
  await prisma.callRecord.updateMany({
    where: { retellCallId, recordingStatus: { in: ["pending", "failed"] } },
    data: { recordingStatus: "failed", recordingError: error.slice(0, 500) },
  });
}

/** Marks a call that reported a recording but turned out to have none (provider returned null). */
export async function markRecordingMissing(retellCallId: string): Promise<void> {
  await prisma.callRecord.updateMany({ where: { retellCallId, recordingStatus: "pending" }, data: { recordingStatus: "none", recordingError: null } });
}

/**
 * Rolls a stuck `pending` row back to `none` so the next webhook event can re-queue the copy.
 * Only touches rows that never got a storage key (enqueue failed before the worker ran).
 */
export async function resetRecordingPending(retellCallId: string): Promise<{ reset: boolean }> {
  const result = await prisma.callRecord.updateMany({
    where: { retellCallId, recordingStatus: "pending", recordingKey: null },
    data: { recordingStatus: "none", recordingError: null },
  });
  return { reset: result.count > 0 };
}

/** Pending longer than this with no storage key means the enqueue (or the worker) never got traction. */
export const STALE_RECORDING_PENDING_MS = 60 * 60 * 1000;

/**
 * Retell call ids whose recording copy has been `pending` for more than an hour and was never stored.
 * Failed rows are left alone (admin-visible). The daily purge job re-enqueues these; jobId dedupe is safe.
 */
export async function listStalePendingRecordings(now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STALE_RECORDING_PENDING_MS);
  const rows = await prisma.callRecord.findMany({
    where: { recordingStatus: "pending", purgedAt: null, recordingKey: null, updatedAt: { lt: cutoff } },
    select: { retellCallId: true },
    orderBy: { updatedAt: "asc" },
  });
  return rows.map((row) => row.retellCallId);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** Who is asking. Staff need `canViewCalls`; owners and admins always may. */
export type CallViewer = { id?: string; role: "admin" | "client_owner" | "client_staff"; clientId?: string | null; canViewCalls?: boolean | null };

export function canViewClientCalls(viewer: CallViewer, clientId: string): boolean {
  if (viewer.role === "admin") return true;
  if (!viewer.clientId || viewer.clientId !== clientId) return false;
  if (viewer.role === "client_owner") return true;
  return viewer.canViewCalls === true;
}

export function canAccessCall(viewer: CallViewer, call: { clientId: string }): boolean {
  return canViewClientCalls(viewer, call.clientId);
}

/** Admin and owner see the full number; staff see the mask. */
export function canSeeCallerNumber(viewer: CallViewer): boolean {
  return viewer.role === "admin" || viewer.role === "client_owner";
}

function viewerContext(viewer: CallViewer): TenantContext {
  if (viewer.role === "admin") return { role: "admin" };
  return { role: viewer.role, clientId: viewer.clientId ?? "" };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CallListFilter = {
  from?: Date | null;
  to?: Date | null;
  outcome?: CallOutcome | null;
  limit?: number;
  /** `startedAt|id` of the last row seen, newest-first pagination. */
  cursor?: string | null;
};

export type CallSummaryRow = {
  id: string;
  retellCallId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  caller: string;
  outcome: CallOutcome | null;
  sentiment: string | null;
  endReason: string | null;
  hasRecording: boolean;
  purgedAt: Date | null;
  flags: CallFlag[];
  flagged: boolean;
};

export type CallListPage = { rows: CallSummaryRow[]; nextCursor: string | null };

const PAGE_LIMIT = 25;

function encodeCursor(row: { startedAt: Date | null; createdAt: Date; id: string }): string {
  return `${(row.startedAt ?? row.createdAt).toISOString()}|${row.id}`;
}

function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

function summaryRow(row: {
  id: string;
  retellCallId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  callerMasked: string;
  callerE164Cipher: string | null;
  outcome: string | null;
  sentiment: string | null;
  endReason: string | null;
  recordingStatus: string;
  purgedAt: Date | null;
  flags?: unknown;
}, fullNumber: boolean): CallSummaryRow {
  const caller = fullNumber ? open(row.callerE164Cipher) ?? row.callerMasked : row.callerMasked;
  const flags = parseCallFlags(row.flags);
  return {
    id: row.id,
    retellCallId: row.retellCallId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    caller: caller || "unknown",
    outcome: (row.outcome as CallOutcome | null) ?? null,
    sentiment: row.sentiment,
    endReason: row.endReason,
    hasRecording: row.recordingStatus === "stored",
    purgedAt: row.purgedAt,
    flags,
    flagged: flags.length > 0,
  };
}

/** Newest first. Returns an empty page, not an error, when the viewer may not see the client. */
export async function listCalls(viewer: CallViewer, clientId: string, filter: CallListFilter = {}): Promise<CallListPage> {
  assertTenantContext(viewerContext(viewer));
  if (!canViewClientCalls(viewer, clientId)) return { rows: [], nextCursor: null };
  const limit = Math.min(Math.max(filter.limit ?? PAGE_LIMIT, 1), 100);
  const cursor = decodeCursor(filter.cursor);
  const where: Prisma.CallRecordWhereInput = {
    clientId,
    ...(filter.outcome ? { outcome: filter.outcome } : {}),
    ...(filter.from || filter.to
      ? { startedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
      : {}),
    ...(cursor
      ? { OR: [{ startedAt: { lt: cursor.at } }, { startedAt: cursor.at, id: { lt: cursor.id } }, { startedAt: null, createdAt: { lt: cursor.at } }] }
      : {}),
  };
  const rows = await prisma.callRecord.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => summaryRow(row, canSeeCallerNumber(viewer))),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

export type CallDetail = CallSummaryRow & {
  clientId: string;
  transcript: CallTranscript | null;
  summary: string | null;
  successful: boolean | null;
  inVoicemail: boolean | null;
  costCents: number | null;
  recordingStatus: RecordingStatus;
  recordingError: string | null;
  recordingContentType: string | null;
  recordingBytes: number | null;
  /** Only filled for admins. */
  rawEvents: unknown[] | null;
  message: { id: string; callerName: string; body: string; createdAt: Date } | null;
  analyzedAt: Date | null;
};

/** Null when the call does not exist or the viewer may not see it (callers answer 404, never 403). */
export async function getCall(viewer: CallViewer, callId: string): Promise<CallDetail | null> {
  assertTenantContext(viewerContext(viewer));
  const row = await prisma.callRecord.findUnique({ where: { id: callId } });
  if (!row || !canAccessCall(viewer, row)) return null;
  const message = await prisma.clientMessage.findFirst({
    where: { clientId: row.clientId, retellCallId: row.retellCallId },
    select: { id: true, callerName: true, callerNameCipher: true, body: true, bodyCipher: true, createdAt: true },
  });
  return {
    ...summaryRow(row, canSeeCallerNumber(viewer)),
    clientId: row.clientId,
    transcript: parseTranscript(row.transcriptCipher),
    summary: open(row.summaryCipher),
    successful: row.successful,
    inVoicemail: row.inVoicemail,
    costCents: viewer.role === "admin" ? row.costCents : null,
    recordingStatus: row.recordingStatus as RecordingStatus,
    recordingError: viewer.role === "admin" ? row.recordingError : null,
    recordingContentType: row.recordingContentType,
    recordingBytes: row.recordingBytes,
    rawEvents: viewer.role === "admin" ? parseRawEvents(row.rawEventsCipher) : null,
    message: message ? { id: message.id, callerName: readField(message.callerNameCipher, message.callerName), body: readField(message.bodyCipher, message.body), createdAt: message.createdAt } : null,
    analyzedAt: row.analyzedAt,
  };
}

/** Message → call links: CallRecord ids by Retell call id, only for calls the viewer may open. */
export async function callLinksFor(viewer: CallViewer, clientId: string, retellCallIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  assertTenantContext(viewerContext(viewer));
  const ids = [...new Set(retellCallIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0 || !canViewClientCalls(viewer, clientId)) return new Map();
  const rows = await prisma.callRecord.findMany({ where: { clientId, retellCallId: { in: ids } }, select: { id: true, retellCallId: true } });
  return new Map(rows.map((row) => [row.retellCallId, row.id]));
}

/** Storage location for playback, after the same access check as `getCall`. */
export async function recordingForPlayback(viewer: CallViewer, callId: string): Promise<{ key: string; contentType: string; bytes: number | null } | null> {
  assertTenantContext(viewerContext(viewer));
  const row = await prisma.callRecord.findUnique({ where: { id: callId }, select: { clientId: true, recordingKey: true, recordingStatus: true, recordingContentType: true, recordingBytes: true } });
  if (!row || !canAccessCall(viewer, row) || row.recordingStatus !== "stored" || !row.recordingKey) return null;
  return { key: row.recordingKey, contentType: row.recordingContentType ?? "audio/wav", bytes: row.recordingBytes };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export type PurgeDeps = { deleteObject: (key: string) => Promise<void> };

export type PurgeReport = { clients: number; purged: number; recordingsDeleted: number; failures: Array<{ callRecordId: string; error: string }> };

function purgeCutoff(client: { callRetentionDays: number; archivedAt: Date | null; serviceEndsAt: Date | null }, now: Date): Date {
  const retention = new Date(now.getTime() - client.callRetentionDays * 86_400_000);
  if (!client.archivedAt) return retention;
  // Archived clients: everything goes once service has been over for the grace period.
  const endedAt = client.serviceEndsAt ?? client.archivedAt;
  const hardStop = new Date(endedAt.getTime() + ARCHIVED_PURGE_GRACE_DAYS * 86_400_000);
  return now >= hardStop ? now : retention;
}

/**
 * Purges transcript, summary, caller number, raw events, and the recording for calls older than each
 * client's retention. Keeps duration, outcome, sentiment, and cost. Safe to re-run: purged rows are skipped.
 * One ChangeLog line per client per run, only when something was purged.
 */
export async function purgeExpiredCalls(deps: PurgeDeps, now = new Date()): Promise<PurgeReport> {
  const clientRows = await prisma.client.findMany({ select: { id: true, name: true, callRetentionDays: true, archivedAt: true, serviceEndsAt: true } });
  const report: PurgeReport = { clients: 0, purged: 0, recordingsDeleted: 0, failures: [] };
  for (const client of clientRows) {
    const cutoff = purgeCutoff(client, now);
    const due = await prisma.callRecord.findMany({
      where: { clientId: client.id, purgedAt: null, OR: [{ startedAt: { lte: cutoff } }, { startedAt: null, createdAt: { lte: cutoff } }] },
      select: { id: true, recordingKey: true, recordingStatus: true },
      orderBy: { createdAt: "asc" },
    });
    let purgedHere = 0;
    for (const call of due) {
      try {
        if (call.recordingKey && call.recordingStatus === "stored") {
          await deps.deleteObject(call.recordingKey);
          report.recordingsDeleted += 1;
        }
        await prisma.callRecord.update({
          where: { id: call.id },
          data: {
            transcriptCipher: null,
            summaryCipher: null,
            rawEventsCipher: null,
            callerE164Cipher: null,
            recordingKey: null,
            recordingError: null,
            recordingBytes: null,
            flags: Prisma.DbNull,
            recordingStatus: call.recordingStatus === "stored" || call.recordingStatus === "pending" || call.recordingStatus === "failed" ? "purged" : call.recordingStatus,
            purgedAt: now,
          },
        });
        purgedHere += 1;
      } catch (error) {
        report.failures.push({ callRecordId: call.id, error: error instanceof Error ? error.message : "purge failed" });
      }
    }
    report.clients += 1;
    report.purged += purgedHere;
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: client.id }, data: { lastCallPurgeAt: now, lastCallPurgeCount: purgedHere } });
      if (purgedHere > 0) {
        await recordChange(tx, {
          clientId: client.id,
          actor: PURGE_ACTOR,
          action: "calls.purged",
          entityType: "client",
          entityId: client.id,
          summary: `Purged ${purgedHere} call${purgedHere === 1 ? "" : "s"} older than ${client.callRetentionDays} days for ${client.name}`,
          after: { purged: purgedHere, retentionDays: client.callRetentionDays },
        });
      }
    });
  }
  return report;
}

export function callRetentionDaysValid(value: number): boolean {
  return Number.isInteger(value) && value >= CALL_RETENTION_LIMITS.min && value <= CALL_RETENTION_LIMITS.max;
}

// ---------------------------------------------------------------------------
// Call access grants (Part 3)
// ---------------------------------------------------------------------------

/** Owner (or admin) toggles whether a staff member may view calls. Writes a ChangeLog line each time. */
export async function setCallAccess(ctx: Actor, input: { userId: string; canViewCalls: boolean }): Promise<{ changed: boolean }> {
  assertTenantContext(ctx);
  if (ctx.role === "client_staff") throw new Error("Only the client owner can change call access.");
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, role: true, clientId: true, canViewCalls: true } });
  if (!user || !user.clientId || (ctx.role !== "admin" && user.clientId !== ctx.clientId)) throw new Error("That user is not available.");
  if (user.role !== "client_staff") throw new Error("Owners can always view calls.");
  if (user.canViewCalls === input.canViewCalls) return { changed: false };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { canViewCalls: input.canViewCalls } });
    await recordChange(tx, {
      clientId: user.clientId,
      actor: ctx,
      action: "call_access",
      entityType: "user",
      entityId: user.id,
      summary: `${input.canViewCalls ? "Granted" : "Removed"} call access for ${user.email}`,
      before: { canViewCalls: user.canViewCalls },
      after: { canViewCalls: input.canViewCalls },
    });
  });
  return { changed: true };
}

/** Client-level retention setting, 7–365 days. */
export async function setCallRetention(ctx: Actor, input: { clientId: string; days: number }): Promise<void> {
  assertTenantContext(ctx);
  if (ctx.role === "client_staff") throw new Error("Only the client owner can change retention.");
  if (ctx.role !== "admin" && ctx.clientId !== input.clientId) throw new Error("That client is not available.");
  if (!callRetentionDaysValid(input.days)) throw new Error(`Retention must be between ${CALL_RETENTION_LIMITS.min} and ${CALL_RETENTION_LIMITS.max} days.`);
  const client = await prisma.client.findFirst({ where: { id: input.clientId, archivedAt: null }, select: { id: true, callRetentionDays: true } });
  if (!client) throw new Error("That client is not available.");
  if (client.callRetentionDays === input.days) return;
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: client.id }, data: { callRetentionDays: input.days } });
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "calls.retention_changed",
      entityType: "client",
      entityId: client.id,
      summary: `Call retention set to ${input.days} days`,
      before: { callRetentionDays: client.callRetentionDays },
      after: { callRetentionDays: input.days },
    });
  });
}
