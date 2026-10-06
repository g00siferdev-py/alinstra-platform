import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, logged } = vi.hoisted(() => ({
  db: {
    recordingTarget: vi.fn(),
    markRecordingStored: vi.fn(async () => undefined),
    markRecordingFailed: vi.fn(async () => undefined),
    markRecordingMissing: vi.fn(async () => undefined),
    purgeExpiredCalls: vi.fn(),
    purgeAccessLogs: vi.fn(async () => 0),
    purgeLoginEvents: vi.fn(async () => 0),
    listStalePendingRecordings: vi.fn(async () => [] as string[]),
    listStaleOpenCalls: vi.fn(async () => []),
    applyRetellCall: vi.fn(),
    markCallNoFinalReport: vi.fn(),
    FORCE_END_OPEN_CALL_MS: 3 * 60 * 60 * 1000,
    recordingKeyFor: (clientId: string, callId: string, contentType: string) => `clients/${clientId}/calls/${callId}.${/mpeg/.test(contentType) ? "mp3" : "wav"}`,
  },
  logged: [] as Array<{ level: string; message: string; fields: Record<string, unknown> }>,
}));

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({}),
  log: (level: string, message: string, fields: Record<string, unknown>) => logged.push({ level, message, fields }),
}));
vi.mock("@alinstra/db", () => db);
vi.mock("@alinstra/providers", () => ({ platformsFor: () => ({ voice: {} }) }));
vi.mock("@alinstra/queue", () => ({ enqueueStoreRecording: vi.fn(async () => undefined) }));
vi.mock("@alinstra/storage", () => ({ getStorage: () => ({}) }));

import { runPurgeCalls, runReconcileCalls, runStoreRecording } from "./calls";

const SECRET_URL = "https://retell-recordings.example/private/abc.wav";

function fakeStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const deletes: string[] = [];
  return {
    objects,
    deletes,
    storage: {
      put: async (key: string, body: Buffer, contentType: string) => {
        objects.set(key, { body, contentType });
      },
      delete: async (key: string) => {
        deletes.push(key);
      },
    },
  };
}

describe("store-recording job", () => {
  beforeEach(() => {
    logged.length = 0;
    db.recordingTarget.mockReset();
    db.markRecordingStored.mockClear();
    db.markRecordingFailed.mockClear();
    db.markRecordingMissing.mockClear();
    db.purgeExpiredCalls.mockReset();
    db.listStalePendingRecordings.mockReset();
    db.listStalePendingRecordings.mockResolvedValue([]);
  });

  it("downloads through the provider and stores under the client prefix without keeping the URL", async () => {
    db.recordingTarget.mockResolvedValue({ callRecordId: "rec_1", clientId: "client_1" });
    const { storage, objects } = fakeStorage();
    const fetched: string[] = [];
    const result = await runStoreRecording("call_1", {
      storage,
      fetchRecording: async (id) => {
        fetched.push(id);
        // The real implementation resolves SECRET_URL internally; only bytes come back.
        return { bytes: Buffer.from("RIFF....WAVE"), contentType: "audio/wav" };
      },
    });
    expect(result).toBe("stored");
    expect(fetched).toEqual(["call_1"]);
    expect([...objects.keys()]).toEqual(["clients/client_1/calls/call_1.wav"]);
    expect(db.markRecordingStored).toHaveBeenCalledWith("call_1", { key: "clients/client_1/calls/call_1.wav", contentType: "audio/wav", bytes: 12 });
    expect(JSON.stringify([db.markRecordingStored.mock.calls, logged])).not.toContain(SECRET_URL);
  });

  it("marks failed and rethrows so BullMQ retries", async () => {
    db.recordingTarget.mockResolvedValue({ callRecordId: "rec_1", clientId: "client_1" });
    const { storage, objects } = fakeStorage();
    await expect(
      runStoreRecording("call_1", {
        storage,
        fetchRecording: async () => {
          throw new Error("Recording download failed (503)");
        },
      }),
    ).rejects.toThrow(/503/);
    expect(objects.size).toBe(0);
    expect(db.markRecordingFailed).toHaveBeenCalledWith("call_1", "Recording download failed (503)");
    expect(JSON.stringify(logged)).not.toContain(SECRET_URL);
  });

  it("skips calls that are unknown or already stored, and records a missing recording", async () => {
    db.recordingTarget.mockResolvedValueOnce(null);
    const { storage } = fakeStorage();
    expect(await runStoreRecording("call_gone", { storage, fetchRecording: async () => null })).toBe("skipped");
    db.recordingTarget.mockResolvedValueOnce({ callRecordId: "rec_2", clientId: "client_1" });
    expect(await runStoreRecording("call_2", { storage, fetchRecording: async () => null })).toBe("missing");
    expect(db.markRecordingMissing).toHaveBeenCalledWith("call_2");
    expect(db.markRecordingStored).not.toHaveBeenCalled();
  });

  it("deletes recordings through storage during the purge and requeues stale pending copies", async () => {
    const { storage, deletes } = fakeStorage();
    db.purgeExpiredCalls.mockImplementation(async (deps: { deleteObject: (key: string) => Promise<void> }) => {
      await deps.deleteObject("clients/client_1/calls/call_old.wav");
      return { clients: 1, purged: 1, recordingsDeleted: 1, failures: [] };
    });
    const requeued: string[] = [];
    const report = await runPurgeCalls({
      storage,
      listStale: async () => ["call_stale", "call_other"],
      enqueueRecording: async (id) => {
        requeued.push(id);
      },
    });
    expect(report.purged).toBe(1);
    expect(deletes).toEqual(["clients/client_1/calls/call_old.wav"]);
    expect(requeued).toEqual(["call_stale", "call_other"]);
    expect(logged.some((row) => row.message === "stale pending recordings requeued" && row.fields.requeued === 2)).toBe(true);
  });

  it("purges the access log in the same nightly run, and a failure there does not block the requeue", async () => {
    const { storage } = fakeStorage();
    db.purgeExpiredCalls.mockResolvedValue({ clients: 0, purged: 0, recordingsDeleted: 0, failures: [] });
    const now = new Date("2026-10-06T07:00:00Z");
    const purgeAccess = vi.fn(async () => 7);
    await runPurgeCalls({ storage, listStale: async () => [], purgeAccess }, now);
    expect(purgeAccess).toHaveBeenCalledWith(now);
    expect(logged.some((row) => row.message === "access log purge finished" && row.fields.removed === 7)).toBe(true);

    const requeued: string[] = [];
    await runPurgeCalls({
      storage,
      purgeAccess: async () => {
        throw new Error("db down");
      },
      listStale: async () => ["call_stale"],
      enqueueRecording: async (id) => {
        requeued.push(id);
      },
    });
    expect(logged.some((row) => row.message === "access log purge failed")).toBe(true);
    expect(requeued).toEqual(["call_stale"]);
  });

  it("also purges the sign-in log (180 days) in the nightly sweep, and a failure there never blocks the rest", async () => {
    const { storage } = fakeStorage();
    db.purgeExpiredCalls.mockResolvedValue({ clients: 0, purged: 0, recordingsDeleted: 0, failures: [] });
    const now = new Date("2026-10-06T07:00:00Z");
    const purgeAccess = vi.fn(async () => 1);
    const purgeLogins = vi.fn(async () => 4);
    await runPurgeCalls({ storage, listStale: async () => [], purgeAccess, purgeLogins }, now);
    expect(purgeAccess).toHaveBeenCalledWith(now);
    expect(purgeLogins).toHaveBeenCalledWith(now);
    expect(logged.some((row) => row.message === "login event purge finished" && row.fields.removed === 4)).toBe(true);

    const requeued: string[] = [];
    await runPurgeCalls({
      storage,
      purgeAccess,
      purgeLogins: async () => {
        throw new Error("db down");
      },
      listStale: async () => ["call_stale"],
      enqueueRecording: async (id) => {
        requeued.push(id);
      },
    });
    expect(logged.some((row) => row.message === "login event purge failed")).toBe(true);
    expect(requeued).toEqual(["call_stale"]);
  });
});

describe("reconcile-calls job", () => {
  it("applies ended Retell calls and force-ends missing or long-running ones", async () => {
    const now = new Date("2026-10-06T15:00:00.000Z");
    const applied: string[] = [];
    const forced: string[] = [];
    const report = await runReconcileCalls(
      {
        listStale: async () => [
          {
            id: "cr_ended",
            retellCallId: "call_ended",
            clientId: "c1",
            startedAt: new Date(now.getTime() - 90 * 60_000),
            createdAt: new Date(now.getTime() - 90 * 60_000),
            durationSeconds: null,
          },
          {
            id: "cr_missing",
            retellCallId: "call_missing",
            clientId: "c1",
            startedAt: new Date(now.getTime() - 90 * 60_000),
            createdAt: new Date(now.getTime() - 90 * 60_000),
            durationSeconds: null,
          },
          {
            id: "cr_long",
            retellCallId: "call_long",
            clientId: "c1",
            startedAt: new Date(now.getTime() - 4 * 60 * 60_000),
            createdAt: new Date(now.getTime() - 4 * 60 * 60_000),
            durationSeconds: null,
          },
          {
            id: "cr_wait",
            retellCallId: "call_wait",
            clientId: "c1",
            startedAt: new Date(now.getTime() - 90 * 60_000),
            createdAt: new Date(now.getTime() - 90 * 60_000),
            durationSeconds: null,
          },
        ],
        getCall: async (id) => {
          if (id === "call_ended") {
            return {
              call_id: id,
              call_status: "ended",
              agent_id: "agent_1",
              start_timestamp: now.getTime() - 90 * 60_000,
              end_timestamp: now.getTime() - 89 * 60_000,
              duration_ms: 60_000,
            };
          }
          if (id === "call_missing") return null;
          return { call_id: id, call_status: "ongoing", start_timestamp: now.getTime() - 90 * 60_000 };
        },
        applyEnded: async (payload) => {
          applied.push(payload.call?.call_id ?? "");
          return { recordingQueued: false, callRecordId: "cr_ended" };
        },
        markNoFinal: async (id) => {
          forced.push(id);
          return { updated: true, callRecordId: id };
        },
      },
      now,
    );
    expect(report).toMatchObject({ checked: 4, applied: 1, forced: 2, skipped: 1, failures: 0 });
    expect(applied).toEqual(["call_ended"]);
    expect(forced.sort()).toEqual(["call_long", "call_missing"]);
  });
});
