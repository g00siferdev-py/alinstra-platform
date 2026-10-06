import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ RETELL_API_KEY: "key", ADMIN_EMAIL: "daniel@alinstra.com", NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }),
  log: vi.fn(),
}));
vi.mock("@alinstra/providers", () => ({ verifyRetell: () => true }));
vi.mock("@alinstra/db", () => ({
  clientIdForRetellAgent: vi.fn(async () => "client_1"),
  plainCallerName: (value: string) => value.split("\n").join(" ").trim() || "Caller",
  recordTakenMessage: vi.fn(async () => ({
    sentence: "I've passed that message to the office.",
    recipients: ["office@example.com"],
    receivedAt: new Date("2026-10-04T15:34:00.000Z"),
    timezone: "America/New_York",
  })),
}));
vi.mock("@alinstra/queue", () => ({
  enqueueMessageEmail: vi.fn(async () => undefined),
}));

import { recordTakenMessage } from "@alinstra/db";
import { enqueueMessageEmail } from "@alinstra/queue";
import { POST } from "./route";

function call(args: Record<string, string>) {
  return POST(new Request("http://localhost/api/retell/tools/take-message", {
    method: "POST",
    body: JSON.stringify({ call: { agent_id: "agent_1", call_id: "call_abc" }, args }),
  }));
}

describe("take message route", () => {
  beforeEach(() => {
    vi.mocked(recordTakenMessage).mockClear();
    vi.mocked(enqueueMessageEmail).mockClear();
  });

  it("tells the agent what is missing and never returns 500", async () => {
    const empty = await call({});
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ result: "I still need the caller's callback number and message." });
    const partial = await call({ callback_number: "4155550100" });
    expect(partial.status).toBe(200);
    expect(await partial.json()).toEqual({ result: "I still need the message." });
    expect(recordTakenMessage).not.toHaveBeenCalled();
  });

  it("saves a complete message and still succeeds when the email queue fails", async () => {
    vi.mocked(enqueueMessageEmail).mockRejectedValueOnce(new Error("redis down"));
    const response = await call({ caller_name: "Pat\nBcc", callback_number: "4155550100", message: "The heat is out" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "I've passed that message to the office." });
    expect(recordTakenMessage).toHaveBeenCalled();
    // Phase 4b: the Retell call id rides along so the message links to its call.
    expect(vi.mocked(recordTakenMessage).mock.calls[0]?.[3]).toBe("call_abc");
    const again = await call({ caller_name: "Pat", callback_number: "4155550100", message: "The heat is out" });
    expect(again.status).toBe(200);
    expect(enqueueMessageEmail).toHaveBeenLastCalledWith(expect.objectContaining({ receivedAt: "2026-10-04T15:34:00.000Z", timezone: "America/New_York" }));
  });
});
