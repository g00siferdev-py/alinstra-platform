import { describe, expect, it } from "vitest";
import { httpBilling, httpVoice } from "./http";

describe("provider HTTP clients", () => {
  it("creates a Retell LLM without using the network", async () => {
    const calls: string[] = [];
    const voice = httpVoice("test-key", async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ llm_id: "llm_test", agent_id: "agent_test", phone_number: "+15551212", version: 0, is_published: false }), { status: 201 });
    });
    const created = await voice.createLlm({ clientId: "c1", prompt: "Hello", beginMessage: "Hi", tools: [] });
    expect(created.llmId).toBe("llm_test");
    expect(calls[0]).toBe("POST https://api.retellai.com/create-retell-llm");
  });

  it("publishes a new agent version when the current one is already published", async () => {
    const calls: string[] = [];
    const voice = httpVoice("test-key", async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/get-agent/")) {
        return new Response(JSON.stringify({ version: 2, is_published: true }), { status: 200 });
      }
      if (String(url).includes("/create-agent-version/")) {
        return new Response(JSON.stringify({ version: 3, is_published: false }), { status: 201 });
      }
      return new Response(JSON.stringify({ version: 3 }), { status: 200 });
    });
    const result = await voice.syncAgent({
      clientId: "c1",
      llmId: "llm_test",
      agentId: "agent_test",
      prompt: "Updated",
      beginMessage: "Hi",
      voiceId: "retell-Cimo",
      tools: [],
      webhookUrl: "https://staging.alinstra.com/api/retell/webhook",
      inboundWebhookUrl: "https://staging.alinstra.com/api/retell/inbound",
    });
    expect(result.version).toBe(3);
    expect(calls.some((call) => call.startsWith("POST https://api.retellai.com/publish-agent-version/"))).toBe(true);
    expect(calls.some((call) => call.includes("/update-retell-llm/llm_test?version=3"))).toBe(true);
  });

  it("creates a Stripe customer with an idempotency key and no network call", async () => {
    let idempotency = "";
    const billing = httpBilling("sk_test_local", async (url, init) => {
      idempotency = new Headers(init?.headers).get("Idempotency-Key") ?? "";
      expect(String(url)).toBe("https://api.stripe.com/v1/customers");
      return new Response(JSON.stringify({ id: "cus_test" }), { status: 200 });
    });
    const created = await billing.createCustomer({
      clientId: "c1",
      name: "North",
      email: "a@example.com",
      idempotencyKey: "client_c1_customer",
    });
    expect(created.customerId).toBe("cus_test");
    expect(idempotency).toBe("client_c1_customer");
  });
});
