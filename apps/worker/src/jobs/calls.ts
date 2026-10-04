import { getEnv, log } from "@alinstra/config";
import { markRecordingFailed, markRecordingMissing, markRecordingStored, purgeExpiredCalls, recordingKeyFor, recordingTarget, type PurgeReport } from "@alinstra/db";
import { platformsFor, type RecordingDownload } from "@alinstra/providers";
import { getStorage, type StoredObject } from "@alinstra/storage";

export type CallsDeps = {
  fetchRecording: (retellCallId: string) => Promise<RecordingDownload | null>;
  storage: Pick<StoredObject, "put" | "delete">;
};

export function callsDeps(): CallsDeps {
  const { voice } = platformsFor(getEnv());
  return { fetchRecording: (id) => voice.fetchRecording(id), storage: getStorage() };
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

/** Daily retention sweep. Deletes each stored recording once, then blanks the row's sensitive fields. */
export async function runPurgeCalls(deps: Pick<CallsDeps, "storage"> = callsDeps(), now = new Date()): Promise<PurgeReport> {
  const report = await purgeExpiredCalls({ deleteObject: (key) => deps.storage.delete(key) }, now);
  log("info", "call purge finished", { clients: report.clients, purged: report.purged, recordingsDeleted: report.recordingsDeleted, failures: report.failures.length });
  return report;
}
