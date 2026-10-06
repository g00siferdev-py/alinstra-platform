import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_RESET_LIMIT, RATE_LIMITS } from "./constants";
import { getCounter, resetMemoryCounter } from "./counter";
import { handleAuthRequest } from "./handler";
import { recordPasswordResetRequest } from "./lockout";
import {
  consumeOwnerEditLimit,
  consumePasswordResetHourly,
  consumeRateLimit,
  documentDownloadRateLimitResponse,
  rateLimitedResponse,
  recordingRateLimitResponse,
  retellRateLimitResponse,
} from "./rate-limit";

beforeEach(() => {
  resetMemoryCounter();
});

afterEach(() => {
  vi.useRealTimers();
});

function resetRequest(email: string, ip: string) {
  return new Request("http://localhost:3000/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip, origin: "http://localhost:3000" },
    body: JSON.stringify({ email }),
  });
}

describe("rate limit limits", () => {
  it("matches the Phase S part 5 table", () => {
    expect(RATE_LIMITS).toEqual({
      retellPerIp: { limit: 300, windowSeconds: 60 },
      passwordResetPerEmail: { limit: 5, windowSeconds: 3600 },
      passwordResetPerIp: { limit: 20, windowSeconds: 3600 },
      invitePerClient: { limit: 10, windowSeconds: 3600 },
      ownerEditPerUser: { limit: 30, windowSeconds: 3600 },
      recordingPerUser: { limit: 120, windowSeconds: 600 },
      documentDownloadPerUser: { limit: 60, windowSeconds: 600 },
    });
  });
});

describe("consumeRateLimit", () => {
  it("allows up to the limit, then reports the seconds left in the window", async () => {
    const rule = { limit: 3, windowSeconds: 120 };
    for (let index = 0; index < 3; index += 1) expect(await consumeRateLimit("t", "s", rule)).toEqual({ limited: false });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30_000);
    const decision = await consumeRateLimit("t", "s", rule);
    expect(decision.limited).toBe(true);
    if (decision.limited) {
      expect(decision.retryAfterSeconds).toBeGreaterThan(80);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(90);
    }
  });

  it("frees the subject when the window ends and keeps subjects apart", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    await consumeRateLimit("t", "a", rule);
    expect((await consumeRateLimit("t", "a", rule)).limited).toBe(true);
    expect((await consumeRateLimit("t", "b", rule)).limited).toBe(false);
    expect((await consumeRateLimit("other", "a", rule)).limited).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect((await consumeRateLimit("t", "a", rule)).limited).toBe(false);
  });

  it("builds a 429 with an integer Retry-After header", async () => {
    const response = rateLimitedResponse(41.2);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({ message: "Too many requests. Try again later." });
  });
});

describe("password reset hourly limits", () => {
  it("allows 5 requests per hour per email across IPs, then limits", async () => {
    for (let index = 0; index < 5; index += 1) {
      expect(await consumePasswordResetHourly("Person@Example.com", `203.0.113.${index}`)).toEqual({ limited: false });
    }
    const sixth = await consumePasswordResetHourly("person@example.com ", "198.51.100.1");
    expect(sixth.limited).toBe(true);
    expect(sixth.limited && sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumePasswordResetHourly("someone-else@example.com", "198.51.100.1")).limited).toBe(false);
  });

  it("allows 20 requests per hour per IP across emails, then limits", async () => {
    for (let index = 0; index < 20; index += 1) {
      expect(await consumePasswordResetHourly(`user${index}@example.com`, "203.0.113.50")).toEqual({ limited: false });
    }
    expect((await consumePasswordResetHourly("user21@example.com", "203.0.113.50")).limited).toBe(true);
    expect((await consumePasswordResetHourly("user22@example.com", "203.0.113.51")).limited).toBe(false);
  });

  it("answers 429 with Retry-After once the hourly email cap is spent", async () => {
    for (let index = 0; index < 5; index += 1) await consumePasswordResetHourly("capped@example.com", `203.0.113.${index}`);
    const response = await handleAuthRequest(resetRequest("capped@example.com", "198.51.100.9"));
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
  });

  it("answers 429 with Retry-After once the hourly IP cap is spent", async () => {
    for (let index = 0; index < 20; index += 1) await consumePasswordResetHourly(`user${index}@example.com`, "203.0.113.77");
    const response = await handleAuthRequest(resetRequest("fresh@example.com", "203.0.113.77"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("still enforces the existing short lockout key and now sends Retry-After with it", async () => {
    for (let index = 0; index < PASSWORD_RESET_LIMIT.maxRequests; index += 1) await recordPasswordResetRequest("short@example.com");
    const response = await handleAuthRequest(resetRequest("short@example.com", "198.51.100.20"));
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(PASSWORD_RESET_LIMIT.windowSeconds);
  });

  it("does not spend the hourly counters on requests the short lockout already refused", async () => {
    for (let index = 0; index < PASSWORD_RESET_LIMIT.maxRequests; index += 1) await recordPasswordResetRequest("short2@example.com");
    for (let index = 0; index < 10; index += 1) await handleAuthRequest(resetRequest("short2@example.com", "198.51.100.21"));
    expect(await getCounter().get("rl:reset-email:short2@example.com")).toBe(0);
  });
});

describe("owner edit limit", () => {
  it("allows 30 edits an hour per user, then limits, per user", async () => {
    for (let index = 0; index < 30; index += 1) expect((await consumeOwnerEditLimit("owner_1")).limited).toBe(false);
    const limited = await consumeOwnerEditLimit("owner_1");
    expect(limited.limited).toBe(true);
    expect(limited.limited && limited.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect((await consumeOwnerEditLimit("owner_2")).limited).toBe(false);
  });
});

describe("recording and document download limits", () => {
  it("allows 120 recording requests per 10 minutes per user, then 429 with Retry-After", async () => {
    for (let index = 0; index < 120; index += 1) expect(await recordingRateLimitResponse("user_1")).toBeNull();
    const response = await recordingRateLimitResponse("user_1");
    expect(response?.status).toBe(429);
    const retryAfter = Number(response?.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(await recordingRateLimitResponse("user_2")).toBeNull();
  });

  it("allows 60 document downloads per 10 minutes per user, then 429 with Retry-After", async () => {
    for (let index = 0; index < 60; index += 1) expect(await documentDownloadRateLimitResponse("user_1")).toBeNull();
    const response = await documentDownloadRateLimitResponse("user_1");
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await documentDownloadRateLimitResponse("user_2")).toBeNull();
  });

  it("keeps the recording and download buckets separate", async () => {
    for (let index = 0; index < 60; index += 1) await documentDownloadRateLimitResponse("user_3");
    expect((await documentDownloadRateLimitResponse("user_3"))?.status).toBe(429);
    expect(await recordingRateLimitResponse("user_3")).toBeNull();
  });
});

describe("retell limit helper", () => {
  it("uses the trusted client IP and ignores a spoofed leftmost X-Forwarded-For", async () => {
    const make = (forwarded: string) => new Request("http://localhost/api/retell/webhook", { method: "POST", headers: { "x-forwarded-for": forwarded } });
    for (let index = 0; index < 300; index += 1) expect(await retellRateLimitResponse(make(`10.0.0.${index % 250}, 203.0.113.99`))).toBeNull();
    expect((await retellRateLimitResponse(make("10.9.9.9, 203.0.113.99")))?.status).toBe(429);
  });
});
