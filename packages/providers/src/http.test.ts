import { describe, expect, it } from "vitest";
import { httpBilling, httpVoice } from "./http";
import { STRIPE_API_VERSION, TAKE_MESSAGE_PARAMETERS, TRANSFER_CHECK_PARAMETERS } from "./types";

const customTools = [
  {
    name: "take_message",
    description: "Save a message for the office.",
    url: "https://staging.alinstra.com/api/retell/tools/take-message",
    timeoutMs: 8000,
    parameters: TAKE_MESSAGE_PARAMETERS,
  },
  {
    name: "transfer",
    description: "Allowed: Desk +14155550100.",
    url: "https://staging.alinstra.com/api/retell/tools/transfer",
    timeoutMs: 8000,
    parameters: TRANSFER_CHECK_PARAMETERS,
  },
];

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

  it("sends custom tool parameters and default dynamic variables to create and update the LLM", async () => {
    const bodies: Array<{ url: string; json: Record<string, unknown> }> = [];
    const voice = httpVoice("test-key", async (url, init) => {
      if (init?.body) bodies.push({ url: String(url), json: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (String(url).includes("/get-agent/")) return new Response(JSON.stringify({ version: 1, is_published: false }), { status: 200 });
      return new Response(JSON.stringify({ llm_id: "llm_test", version: 1 }), { status: 200 });
    });
    await voice.createLlm({ clientId: "c1", prompt: "Hello", beginMessage: "Hi", tools: customTools });
    await voice.syncAgent({
      clientId: "c1",
      llmId: "llm_test",
      agentId: "agent_test",
      prompt: "Hello",
      beginMessage: "Hi",
      voiceId: "retell-Cimo",
      tools: customTools,
      webhookUrl: "https://staging.alinstra.com/api/retell/webhook",
      inboundWebhookUrl: "https://staging.alinstra.com/api/retell/inbound",
    });
    const created = bodies.find((entry) => entry.url.endsWith("/create-retell-llm"));
    const updated = bodies.find((entry) => entry.url.includes("/update-retell-llm/"));
    for (const entry of [created, updated]) {
      expect(entry?.json.default_dynamic_variables).toEqual({ office_open: "unknown", allowed_targets: "" });
      const tools = entry?.json.general_tools as Array<Record<string, unknown>>;
      expect(tools.find((tool) => tool.name === "take_message")?.parameters).toEqual(TAKE_MESSAGE_PARAMETERS);
      expect(tools.find((tool) => tool.name === "transfer")?.parameters).toEqual(TRANSFER_CHECK_PARAMETERS);
    }
  });

  it("buys a local number with an area code and a toll-free number without one", async () => {
    const bodies: unknown[] = [];
    const voice = httpVoice("test-key", async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ phone_number: "+18005550100" }), { status: 201 });
    });
    await voice.createNumber({
      clientId: "c1",
      agentId: "agent_test",
      inboundWebhookUrl: "https://staging.alinstra.com/api/retell/inbound",
      tollFree: false,
      areaCode: 423,
    });
    await voice.createNumber({
      clientId: "c0",
      agentId: "agent_zero",
      inboundWebhookUrl: "https://staging.alinstra.com/api/retell/inbound",
      tollFree: true,
      areaCode: null,
    });
    expect(bodies[0]).toEqual({
      inbound_agents: [{ agent_id: "agent_test", weight: 1 }],
      inbound_webhook_url: "https://staging.alinstra.com/api/retell/inbound",
      nickname: "alinstra-c1",
      allowed_outbound_country_list: ["US", "CA"],
      area_code: 423,
    });
    expect(bodies[1]).toEqual({
      inbound_agents: [{ agent_id: "agent_zero", weight: 1 }],
      inbound_webhook_url: "https://staging.alinstra.com/api/retell/inbound",
      nickname: "alinstra-c0",
      allowed_outbound_country_list: ["US", "CA"],
      toll_free: true,
      number_provider: "twilio",
      country_code: "US",
    });
  });

  it("puts the provider error body on the failure and redacts our key", async () => {
    const voice = httpVoice("retell-secret-key", async () => new Response(JSON.stringify({ message: "bad area code retell-secret-key" }), { status: 400 }));
    await expect(voice.createLlm({ clientId: "c1", prompt: "Hello", beginMessage: "Hi", tools: [] })).rejects.toThrow(
      "Retell request failed (400): bad area code [redacted]",
    );
    const billing = httpBilling("sk_test_secret", async () => new Response("not json at all", { status: 402 }));
    await expect(billing.cancelAtPeriodEnd("sub_test")).rejects.toThrow("Stripe request failed (402): not json at all");
    const nested = httpBilling("sk_test_secret", async () => new Response(JSON.stringify({ error: { message: "No such customer" } }), { status: 400 }));
    await expect(nested.cancelAtPeriodEnd("sub_test")).rejects.toThrow("Stripe request failed (400): No such customer");
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

  it("reads the billing period from subscription items and pins the Stripe version", async () => {
    let version = "";
    const billing = httpBilling("sk_test_local", async (_url, init) => {
      version = new Headers(init?.headers).get("Stripe-Version") ?? "";
      return new Response(JSON.stringify({
        id: "sub_test",
        items: { data: [{ current_period_end: 1_800_000_000 }, { current_period_end: 1_900_000_000 }] },
      }), { status: 200 });
    });
    const ends = await billing.cancelAtPeriodEnd("sub_test");
    expect(version).toBe(STRIPE_API_VERSION);
    expect(ends.serviceEndsAt.toISOString()).toBe(new Date(1_900_000_000 * 1000).toISOString());
    const missing = httpBilling("sk_test_local", async () => new Response(JSON.stringify({ id: "sub_test", items: { data: [] } }), { status: 200 }));
    await expect(missing.cancelAtPeriodEnd("sub_test")).rejects.toThrow(/period end/);
  });
});
