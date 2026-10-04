import { describe, expect, it } from "vitest";
import { checkRetellHealth, checkStripeHealth } from "./health";

describe("service health checks", () => {
  it("reads one Retell agent with the key and reports OK", async () => {
    const calls: Array<{ url: string; method: string; auth: string }> = [];
    const result = await checkRetellHealth("retell-secret-key", async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify([{ agent_id: "a1" }]), { status: 200 });
    });
    expect(result).toEqual({ ok: true, detail: "Authenticated. Agents are listed." });
    expect(calls).toEqual([{ url: "https://api.retellai.com/v2/list-agents?limit=1", method: "GET", auth: "Bearer retell-secret-key" }]);
  });

  it("reads the Stripe balance and reports the mode", async () => {
    const result = await checkStripeHealth("sk_test_secret", async (url, init) => {
      expect(url).toBe("https://api.stripe.com/v1/balance");
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({ object: "balance", livemode: false }), { status: 200 });
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain("test mode");
  });

  it("returns the provider error without the key and refuses to call when the key is empty", async () => {
    const retell = await checkRetellHealth("retell-secret-key", async () => new Response(JSON.stringify({ message: "Invalid key retell-secret-key" }), { status: 401 }));
    expect(retell).toEqual({ ok: false, error: "HTTP 401: Invalid key [redacted]" });
    const stripe = await checkStripeHealth("sk_test_secret", async () => new Response(JSON.stringify({ error: { message: "Invalid API Key provided" } }), { status: 401 }));
    expect(stripe).toEqual({ ok: false, error: "HTTP 401: Invalid API Key provided" });
    let called = false;
    const empty = await checkStripeHealth("", async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    expect(empty.ok).toBe(false);
    expect(called).toBe(false);
  });
});
