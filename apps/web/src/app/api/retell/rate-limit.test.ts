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

import { RATE_LIMITS, resetMemoryCounter } from "@alinstra/auth/rate-limit";
import { POST as inbound } from "./inbound/route";
import { POST as takeMessage } from "./tools/take-message/route";
import { POST as transfer } from "./tools/transfer/route";
import { POST as webhook } from "./webhook/route";

const routes = { webhook, inbound, transfer, takeMessage } as const;
const BODY = JSON.stringify({ event: "call_started", call: { call_id: "c1", agent_id: "agent_1" }, call_inbound: { to_number: "" }, args: {} });

function request(ip: string, signature = "good", body = BODY) {
  return new Request("http://localhost/api/retell/x", { method: "POST", headers: { "x-retell-signature": signature, "x-real-ip": ip }, body });
}

describe("retell routes rate limit", () => {
  beforeEach(() => {
    resetMemoryCounter();
    verify.mockClear();
    for (const fn of [db.applyRetellCall, db.inboundCallPayload, db.clientIdForRetellAgent, db.decideTransfer, db.recordTakenMessage]) fn.mockClear();
  });

  it("allows 300 requests a minute per IP, then answers 429 with Retry-After", async () => {
    expect(RATE_LIMITS.retellPerIp).toEqual({ limit: 300, windowSeconds: 60 });
    for (let index = 0; index < 300; index += 1) {
      expect((await webhook(request("203.0.113.5"))).status).toBe(204);
    }
    const limited = await webhook(request("203.0.113.5"));
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("shares one bucket across all four Retell routes and keeps other IPs separate", async () => {
    for (let index = 0; index < 300; index += 1) {
      // Rotate through the routes so the count spans every endpoint.
      const route = Object.values(routes)[index % 4];
      await route?.(request("203.0.113.6"));
    }
    for (const [name, route] of Object.entries(routes)) {
      const response = await route(request("203.0.113.6"));
      expect(response.status, name).toBe(429);
      expect(response.headers.get("retry-after"), name).toBeTruthy();
    }
    expect((await webhook(request("203.0.113.7"))).status).toBe(204);
  });

  it("rate limits before doing signature, parsing or database work", async () => {
    for (let index = 0; index < 300; index += 1) await webhook(request("203.0.113.8", "bad", "not json"));
    verify.mockClear();
    const response = await webhook(request("203.0.113.8", "good"));
    expect(response.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
    expect(db.applyRetellCall).not.toHaveBeenCalled();
  });

  it.each(Object.keys(routes))("%s checks the signature before parsing the body or touching the database", async (name) => {
    const response = await routes[name as keyof typeof routes](request("203.0.113.9", "bad", "{ this is not json"));
    expect(response.status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
    for (const fn of [db.applyRetellCall, db.inboundCallPayload, db.clientIdForRetellAgent, db.decideTransfer, db.recordTakenMessage]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
