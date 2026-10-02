import { describe, expect, it } from "vitest";
import { signRetell, signStripe, verifyRetell, verifyStripe } from "./signature";

const now = Date.parse("2026-10-02T16:00:00.000Z");
const body = "{\"event\":\"call_ended\"}";

describe("Retell signatures", () => {
  it("accepts a fresh signature and rejects a tampered body or a stale timestamp", () => {
    const header = signRetell(body, now, "retell-test-key");
    expect(verifyRetell(body, header, "retell-test-key", now)).toBe(true);
    expect(verifyRetell(`${body} `, header, "retell-test-key", now)).toBe(false);
    expect(verifyRetell(body, header, "other-key", now)).toBe(false);
    expect(verifyRetell(body, header, "retell-test-key", now + 6 * 60 * 1000)).toBe(false);
  });
});

describe("Stripe signatures", () => {
  it("accepts a fresh signature and rejects a tampered body or a stale timestamp", () => {
    const header = signStripe(body, Math.floor(now / 1000), "whsec_test");
    expect(verifyStripe(body, header, "whsec_test", now)).toBe(true);
    expect(verifyStripe("{}", header, "whsec_test", now)).toBe(false);
    expect(verifyStripe(body, header, "whsec_test", now + 6 * 60 * 1000)).toBe(false);
  });
});
