import { beforeEach, describe, expect, it, vi } from "vitest";

const { applied, queued, reset, enqueueImpl } = vi.hoisted(() => ({
  applied: [] as Array<{ event?: string; call?: { call_id?: string } }>,
  queued: [] as string[],
  reset: [] as string[],
  enqueueImpl: { fail: false },
}));

vi.mock("@alinstra/config", () => ({ getEnv: () => ({ RETELL_API_KEY: "key", NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }), log: vi.fn() }));
vi.mock("@alinstra/providers", () => ({ verifyRetell: (_raw: string, signature: string | null) => signature === "good" }));
vi.mock("@alinstra/db", () => ({
  // Fake of the idempotent applier: the first event that carries a recording queues it, nothing else does.
  applyRetellCall: vi.fn(async (payload: { event?: string; call?: { call_id?: string; recording_url?: string } }) => {
    applied.push(payload);
    const id = payload.call?.call_id ?? "";
    const first = Boolean(payload.call?.recording_url) && !applied.slice(0, -1).some((row) => row.call?.call_id === id && (row.call as { recording_url?: string }).recording_url);
    return { recordingQueued: first, callRecordId: id ? `rec_${id}` : null };
  }),
  resetRecordingPending: vi.fn(async (retellCallId: string) => {
    reset.push(retellCallId);
    return { reset: true };
  }),
}));
vi.mock("@alinstra/queue", () => ({
  enqueueStoreRecording: vi.fn(async (data: { retellCallId: string }) => {
    if (enqueueImpl.fail) throw new Error("redis down");
    queued.push(data.retellCallId);
  }),
}));

import { resetRecordingPending } from "@alinstra/db";
import { POST } from "./route";

function post(body: unknown, signature = "good") {
  return POST(new Request("http://localhost/api/retell/webhook", { method: "POST", headers: { "x-retell-signature": signature }, body: JSON.stringify(body) }));
}

describe("retell webhook route", () => {
  beforeEach(() => {
    applied.length = 0;
    queued.length = 0;
    reset.length = 0;
    enqueueImpl.fail = false;
    vi.mocked(resetRecordingPending).mockClear();
  });

  it("rejects bad signatures before touching the database", async () => {
    const response = await post({ event: "call_ended", call: { call_id: "c1" } }, "bad");
    expect(response.status).toBe(401);
    expect(applied).toHaveLength(0);
  });

  it("queues the recording copy once across duplicate and out-of-order events", async () => {
    const call = { call_id: "c1", agent_id: "agent_1", recording_url: "https://retell.example/private.wav" };
    expect((await post({ event: "call_analyzed", call })).status).toBe(204);
    expect((await post({ event: "call_ended", call })).status).toBe(204);
    expect((await post({ event: "call_analyzed", call })).status).toBe(204);
    expect((await post({ event: "call_started", call: { call_id: "c1", agent_id: "agent_1" } })).status).toBe(204);
    expect(applied.map((row) => row.event)).toEqual(["call_analyzed", "call_ended", "call_analyzed", "call_started"]);
    expect(queued).toEqual(["c1"]);
    expect(reset).toEqual([]);
  });

  it("resets pending when enqueue fails so a later event can re-queue", async () => {
    enqueueImpl.fail = true;
    const call = { call_id: "c_stuck", agent_id: "agent_1", recording_url: "https://retell.example/private.wav" };
    expect((await post({ event: "call_ended", call })).status).toBe(204);
    expect(queued).toEqual([]);
    expect(reset).toEqual(["c_stuck"]);
    expect(resetRecordingPending).toHaveBeenCalledWith("c_stuck");
  });
});
