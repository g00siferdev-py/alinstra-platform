import { getEnv, log } from "@alinstra/config";
import {
  applyRetellCall,
  FORCE_END_OPEN_CALL_MS,
  listStaleOpenCalls,
  listStalePendingRecordings,
  markCallNoFinalReport,
  markRecordingFailed,
  markRecordingMissing,
  markRecordingStored,
  purgeAccessLogs,
  purgeExpiredCalls,
  purgeLoginEvents,
  recordingKeyFor,
  recordingTarget,
  type PurgeReport,
  type StaleOpenCall,
} from "@alinstra/db";
import { platformsFor, type RecordingDownload, type RetellCallSnapshot } from "@alinstra/providers";
import { enqueueStoreRecording } from "@alinstra/queue";
import { getStorage, type StoredObject } from "@alinstra/storage";

export type CallsDeps = {
  fetchRecording: (retellCallId: string) => Promise<RecordingDownload | null>;
  storage: Pick<StoredObject, "put" | "delete">;
};

export type PurgeCallsDeps = Pick<CallsDeps, "storage"> & {
  enqueueRecording?: (retellCallId: string) => Promise<void>;
  listStale?: (now: Date) => Promise<string[]>;
  /** Deletes AccessLog rows older than 400 days; injectable for tests. */
  purgeAccess?: (now: Date) => Promise<number>;
  /** Deletes LoginEvent rows older than 180 days; injectable for tests. */
  purgeLogins?: (now: Date) => Promise<number>;
};

export type ReconcileCallsDeps = {
  getCall: (retellCallId: string) => Promise<RetellCallSnapshot | null>;
  listStale?: (now: Date) => Promise<StaleOpenCall[]>;
  applyEnded?: typeof applyRetellCall;
  markNoFinal?: typeof markCallNoFinalReport;
};

export function callsDeps(): CallsDeps {
  const { voice } = platformsFor(getEnv());
  return { fetchRecording: (id) => voice.fetchRecording(id), storage: getStorage() };
}

export function reconcileCallsDeps(): ReconcileCallsDeps {
  const { voice } = platformsFor(getEnv());
  return { getCall: (id) => voice.getCall(id) };
}

export type StoreRecordingResult = "stored" | "skipped" | "missing";

/**
 * Copies a call recording from the provider into our bucket. The provider URL is resolved inside
 * `fetchRecording` and never logged or persisted. Throws on download/storage failure so BullMQ retries
 * (3 attempts, exponential backoff); the row is marked `failed` with the error on each failure.
 */
export async function runStoreRecording(retellCallId: string, deps: CallsDeps = callsDeps()): Promise<StoreRecordingResult> {
  const target = await recordingTarget(retellCallId);
  if (!target) return "skipped";
  try {
    const download = await deps.fetchRecording(retellCallId);
    if (!download) {
      await markRecordingMissing(retellCallId);
      return "missing";
    }
    const key = recordingKeyFor(target.clientId, retellCallId, download.contentType);
    await deps.storage.put(key, download.bytes, download.contentType);
    await markRecordingStored(retellCallId, { key, contentType: download.contentType, bytes: download.bytes.byteLength });
    return "stored";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recording copy failed";
    await markRecordingFailed(retellCallId, message);
    log("error", "recording copy failed", { retellCallId, error: error instanceof Error ? error.name : "unknown" });
    throw error;
  }
}

/**
 * Daily retention sweep, plus a re-enqueue of recordings stuck in `pending` for more than an hour
 * (enqueue blip or a worker that never picked them up). Failed rows stay failed for admin visibility.
 */
export async function runPurgeCalls(deps: PurgeCallsDeps = callsDeps(), now = new Date()): Promise<PurgeReport> {
  const report = await purgeExpiredCalls({ deleteObject: (key) => deps.storage.delete(key) }, now);
  log("info", "call purge finished", { clients: report.clients, purged: report.purged, recordingsDeleted: report.recordingsDeleted, failures: report.failures.length });

  // Read-access audit log (Phase S part 2): keep 400 days. A failure here must not block the requeue below.
  try {
    const removed = await (deps.purgeAccess ?? purgeAccessLogs)(now);
    log("info", "access log purge finished", { removed });
  } catch (error) {
    log("error", "access log purge failed", { error: error instanceof Error ? error.name : "unknown" });
  }

  // Sign-in attempt log (Phase S part 3): keep 180 days. Same rule: never blocks the rest of the sweep.
  try {
    const removed = await (deps.purgeLogins ?? purgeLoginEvents)(now);
    log("info", "login event purge finished", { removed });
  } catch (error) {
    log("error", "login event purge failed", { error: error instanceof Error ? error.name : "unknown" });
  }

  const enqueue = deps.enqueueRecording ?? ((retellCallId: string) => enqueueStoreRecording({ retellCallId }));
  const listStale = deps.listStale ?? listStalePendingRecordings;
  const stale = await listStale(now);
  let requeued = 0;
  for (const retellCallId of stale) {
    try {
      await enqueue(retellCallId);
      requeued += 1;
    } catch (error) {
      log("error", "stale recording requeue failed", { retellCallId, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  if (stale.length > 0 || requeued > 0) {
    log("info", "stale pending recordings requeued", { found: stale.length, requeued });
  }
  return report;
}

export type ReconcileCallsReport = { checked: number; applied: number; forced: number; skipped: number; failures: number };

/**
 * Resolves CallRecords stuck without endedAt. Fetches each from Retell; applies ended calls through
 * applyRetellCall; force-ends not-found or still-ongoing calls older than 3 hours.
 */
export async function runReconcileCalls(deps: ReconcileCallsDeps = reconcileCallsDeps(), now = new Date()): Promise<ReconcileCallsReport> {
  const listStale = deps.listStale ?? listStaleOpenCalls;
  const applyEnded = deps.applyEnded ?? applyRetellCall;
  const markNoFinal = deps.markNoFinal ?? markCallNoFinalReport;
  const stale = await listStale(now);
  const report: ReconcileCallsReport = { checked: stale.length, applied: 0, forced: 0, skipped: 0, failures: 0 };

  for (const row of stale) {
    try {
      const call = await deps.getCall(row.retellCallId);
      if (!call) {
        await markNoFinal(row.retellCallId);
        report.forced += 1;
        continue;
      }
      const status = (call.call_status ?? "").toLowerCase();
      const ended = status === "ended" || status === "error" || typeof call.end_timestamp === "number";
      if (ended) {
        await applyEnded({
          event: call.call_analysis ? "call_analyzed" : "call_ended",
          call,
        });
        report.applied += 1;
        continue;
      }
      const start = row.startedAt ?? row.createdAt;
      if (now.getTime() - start.getTime() > FORCE_END_OPEN_CALL_MS) {
        await markNoFinal(row.retellCallId);
        report.forced += 1;
      } else {
        report.skipped += 1;
      }
    } catch (error) {
      report.failures += 1;
      log("error", "reconcile call failed", { retellCallId: row.retellCallId, error: error instanceof Error ? error.name : "unknown" });
    }
  }

  if (report.checked > 0) {
    log("info", "reconcile calls finished", report);
  }
  return report;
}
