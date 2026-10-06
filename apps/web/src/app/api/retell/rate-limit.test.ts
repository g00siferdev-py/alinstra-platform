import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, verify } = vi.hoisted(() => ({
  db: {
    applyRetellCall: vi.fn(async () => ({ recordingQueued: false })),
    resetRecordingPending: vi.fn(async () => ({ reset: true })),
    inboundCallPayload: vi.fn(async () => ({ dynamic_variables: {} })),
    clientIdForRetellAgent: vi.fn(async () => "client_1"),
    decideTransfer: vi.fn(async () => ({ allowed: false, reason: "no" })),
    plainCallerName: (value: string) => value,
    recordTakenMessage: vi.fn(async () => ({ sentence: "ok", recipients: [], receivedAt: new Date(), timezone: "UTC" })),
    TRANSFER_UNAVAILABLE: "unavailable",
  },
  verify: vi.fn((_raw: string, signature: string | null) => signature === "good"),
}));

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ RETELL_API_KEY: "key", ADMIN_EMAIL: "a@example.com", NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }),
  log: vi.fn(),
}));
vi.mock("@alinstra/providers", () => ({ verifyRetell: verify }));
vi.mock("@alinstra/db", () => db);
vi.mock("@alinstra/queue", () => ({ enqueueStoreRecording: vi.fn(), enqueueMessageEmail: vi.fn() }));

import { RATE_LIMITS, RETELL_MAX_BODY_BYTES, resetMemoryCounter } from "@alinstra/auth/rate-limit";
import { POST as inbound } from "./inbound/route";
import { POST as takeMessage } from "./tools/take-message/route";
import { POST as transfer } from "./tools/transfer/route";
import { POST as webhook } from "./webhook/route";

const routes = { webhook, inbound, transfer, takeMessage } as const;
const BODY = JSON.stringify({ event: "call_started", call: { call_id: "c1", agent_id: "agent_1" }, call_inbound: { to_number: "" }, args: {} });

function request(ip: string, signature = "good", body = BODY, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/retell/x", {
    method: "POST",
    headers: { "x-retell-signature": signature, "x-real-ip": ip, ...extraHeaders },
    body,
  });
}

describe("retell routes rate limit", () => {
  beforeEach(() => {
    resetMemoryCounter();
    verify.mockClear();
    for (const fn of [db.applyRetellCall, db.inboundCallPayload, db.clientIdForRetellAgent, db.decideTransfer, db.recordTakenMessage]) fn.mockClear();
  });

  it("never rate-limits valid signed traffic, even past the old 300/min cap", async () => {
    expect(RATE_LIMITS.retellBadSignaturePerIp).toEqual({ limit: 30, windowSeconds: 600 });
    for (let index = 0; index < 1000; index += 1) {
      expect((await webhook(request("203.0.113.5"))).status).toBe(204);
    }
    expect(db.applyRetellCall).toHaveBeenCalledTimes(1000);
  });

  it("returns 429 after 30 bad signatures from one IP, and keeps other IPs separate", async () => {
    for (let index = 0; index < 30; index += 1) {
      expect((await webhook(request("203.0.113.6", "bad"))).status).toBe(401);
    }
    const limited = await webhook(request("203.0.113.6", "bad"));
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect((await webhook(request("203.0.113.7", "bad"))).status).toBe(401);
    expect((await webhook(request("203.0.113.6"))).status).toBe(204);
  });

  it("shares the bad-signature bucket across all four Retell routes", async () => {
    for (let index = 0; index < 30; index += 1) {
      const route = Object.values(routes)[index % 4];
      await route?.(request("203.0.113.8", "bad"));
    }
    for (const [name, route] of Object.entries(routes)) {
      const response = await route(request("203.0.113.8", "bad"));
      expect(response.status, name).toBe(429);
      expect(response.headers.get("retry-after"), name).toBeTruthy();
    }
  });

  it("rejects an oversized body with 413 before verifying the signature", async () => {
    expect(RETELL_MAX_BODY_BYTES).toBe(1_048_576);
    const huge = "x".repeat(RETELL_MAX_BODY_BYTES + 1);
    verify.mockClear();
    const response = await webhook(request("203.0.113.9", "good", huge, { "content-length": String(huge.length) }));
    expect(response.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    expect(db.applyRetellCall).not.toHaveBeenCalled();
  });

  it.each(Object.keys(routes))("%s checks the signature before parsing the body or touching the database", async (name) => {
    const response = await routes[name as keyof typeof routes](request("203.0.113.10", "bad", "{ this is not json"));
    expect(response.status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
    for (const fn of [db.applyRetellCall, db.inboundCallPayload, db.clientIdForRetellAgent, db.decideTransfer, db.recordTakenMessage]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
