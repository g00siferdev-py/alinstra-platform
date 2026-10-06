import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ mode: "down" as "down" | "hang" }));
const logged = vi.hoisted(() => [] as Array<{ level: string; message: string; fields: Record<string, unknown> }>);

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }),
  log: (level: string, message: string, fields: Record<string, unknown>) => logged.push({ level, message, fields }),
}));
vi.mock("./counter", () => ({
  resetMemoryCounter: () => undefined,
  getCounter: () => ({
    increment: () => (store.mode === "down" ? Promise.reject(new Error("redis down")) : new Promise<number>(() => undefined)),
    get: async () => 0,
    ttl: async () => 0,
    clear: async () => undefined,
  }),
}));

import { consumeRateLimit, recordingRateLimitResponse } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
  logged.length = 0;
});

describe("rate limit store failure", () => {
  it("fails open when the counter store errors, and never logs the subject", async () => {
    store.mode = "down";
    expect(await consumeRateLimit("reset-email", "secret@example.com", { limit: 1, windowSeconds: 60 })).toEqual({ limited: false });
    expect(await recordingRateLimitResponse("user_1")).toBeNull();
    expect(logged[0]).toEqual({ level: "warn", message: "rate_limit.store_unavailable", fields: { limiter: "reset-email", error: "Error" } });
    expect(JSON.stringify(logged)).not.toContain("secret@example.com");
  });

  it("fails open instead of hanging when the store never answers", async () => {
    store.mode = "hang";
    vi.useFakeTimers();
    const pending = consumeRateLimit("retell", "203.0.113.1", { limit: 1, windowSeconds: 60 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ limited: false });
    expect(logged[0]?.message).toBe("rate_limit.store_unavailable");
  });
});
