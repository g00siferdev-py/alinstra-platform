import { ProviderRequestError, STRIPE_API_VERSION, type AgentPublish, type BillingPlatform, type PriceKind, type PublishedTool, type VoicePlatform } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const RETELL = "https://api.retellai.com";

const DEFAULT_DYNAMIC_VARIABLES = {
  office_open: "unknown",
  allowed_numbers: "",
};

function toolsOf(tools: PublishedTool[]): unknown[] {
  return tools.map((tool) => {
    if (tool.transferTo) {
      return {
        type: "transfer_call",
        name: tool.name,
        description: tool.description,
        transfer_destination: { type: "predefined", number: tool.transferTo },
        transfer_option: { type: "cold_transfer", cold_transfer_mode: "sip_invite" },
      };
    }
    return {
      type: "custom",
      name: tool.name,
      description: tool.description,
      url: tool.url,
      speak_during_execution: true,
      execution_message_description: "One moment.",
      timeout_ms: tool.timeoutMs ?? 8000,
      method: "POST",
      parameters: tool.parameters,
    };
  });
}

export function subscriptionPeriodEnd(body: Record<string, unknown>, now = Date.now()): Date {
  const items = body.items as { data?: Array<{ current_period_end?: unknown }> } | undefined;
  const ends = (items?.data ?? [])
    .map((item) => Number(item.current_period_end))
    .filter((value) => Number.isFinite(value));
  if (ends.length === 0) throw new Error("Stripe did not return a subscription item period end. Nothing was saved.");
  const seconds = Math.max(...ends);
  const endsAt = new Date(seconds * 1000);
  if (!(endsAt.getTime() > now)) throw new Error("Stripe period end is not in the future. Nothing was saved.");
  return endsAt;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 204) return {};
  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

export function httpVoice(apiKey: string, fetchImpl: FetchLike = fetch): VoicePlatform {
  async function send(path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetchImpl(`${RETELL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await readJson(response);
    if (response.status === 404) throw new ProviderRequestError("Retell object was not found", 404);
    if (!response.ok) throw new ProviderRequestError(`Retell request failed (${response.status})`, response.status);
    return { status: response.status, body };
  }

  return {
    async createLlm(input) {
      const { body } = await send("/create-retell-llm", {
        method: "POST",
        body: JSON.stringify({
          general_prompt: input.prompt,
          begin_message: input.beginMessage,
          general_tools: toolsOf(input.tools),
          start_speaker: "agent",
          default_dynamic_variables: DEFAULT_DYNAMIC_VARIABLES,
        }),
      });
      const llmId = String(body.llm_id ?? "");
      if (!llmId) throw new Error("Retell did not return an LLM id");
      return { llmId };
    },
    async findAgentId(clientId) {
      const listed = await send("/v2/list-agents", { method: "GET" }).catch(() => null);
      const items = Array.isArray(listed?.body.items) ? listed.body.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const row = item as { agent_id?: string; agent_name?: string };
        if (row.agent_name === `alinstra-${clientId}` && row.agent_id) return row.agent_id;
      }
      return null;
    },
    async createAgent(input) {
      const { body } = await send("/create-agent", {
        method: "POST",
        body: JSON.stringify({
          agent_name: `alinstra-${input.clientId}`,
          response_engine: { type: "retell-llm", llm_id: input.llmId },
          voice_id: input.voiceId,
          webhook_url: input.webhookUrl,
        }),
      });
      const agentId = String(body.agent_id ?? "");
      if (!agentId) throw new Error("Retell did not return an agent id");
      return { agentId };
    },
    async findNumber(clientId) {
      const listed = await send("/v2/list-phone-numbers", { method: "GET" }).catch(() => null);
      const items = Array.isArray(listed?.body.items) ? listed.body.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const row = item as { phone_number?: string; nickname?: string };
        if (row.nickname === `alinstra-${clientId}` && row.phone_number) return row.phone_number;
      }
      return null;
    },
    async createNumber(input) {
      const { body } = await send("/create-phone-number", {
        method: "POST",
        body: JSON.stringify({
          inbound_agents: [{ agent_id: input.agentId, agent_version: "latest_published", weight: 1 }],
          inbound_webhook_url: input.inboundWebhookUrl,
          nickname: `alinstra-${input.clientId}`,
          allowed_outbound_country_list: ["US", "CA"],
          ...(input.tollFree ? { toll_free: true } : input.areaCode ? { area_code: input.areaCode } : {}),
        }),
      });
      const e164 = String(body.phone_number ?? "");
      if (!e164) throw new Error("Retell did not return a phone number");
      return { e164 };
    },
    async syncAgent(input: AgentPublish) {
      const agent = await send(`/get-agent/${input.agentId}`, { method: "GET" });
      let version = Number(agent.body.version ?? 0);
      if (agent.body.is_published === true) {
        const draft = await send(`/create-agent-version/${input.agentId}`, {
          method: "POST",
          body: JSON.stringify({ base_version: version }),
        });
        version = Number(draft.body.version ?? version + 1);
      }
      await send(`/update-retell-llm/${input.llmId}?version=${version}`, {
        method: "PATCH",
        body: JSON.stringify({
          general_prompt: input.prompt,
          begin_message: input.beginMessage,
          general_tools: toolsOf(input.tools),
          default_dynamic_variables: DEFAULT_DYNAMIC_VARIABLES,
        }),
      });
      await send(`/update-agent/${input.agentId}?version=${version}`, {
        method: "PATCH",
        body: JSON.stringify({
          voice_id: input.voiceId,
          webhook_url: input.webhookUrl,
          response_engine: { type: "retell-llm", llm_id: input.llmId, version },
        }),
      });
      await send(`/publish-agent-version/${input.agentId}`, {
        method: "POST",
        body: JSON.stringify({ version, version_description: `Alinstra sync ${input.clientId}` }),
      });
      return { version };
    },
    async deleteNumber(e164) {
      try {
        await send(`/delete-phone-number/${encodeURIComponent(e164)}`, { method: "DELETE" });
        return "deleted";
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) return "missing";
        throw error;
      }
    },
    async deleteAgent(agentId) {
      try {
        await send(`/delete-agent/${agentId}`, { method: "DELETE" });
        return "deleted";
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) return "missing";
        throw error;
      }
    },
    async deleteLlm(llmId) {
      try {
        await send(`/delete-retell-llm/${llmId}`, { method: "DELETE" });
        return "deleted";
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) return "missing";
        throw error;
      }
    },
  };
}

function formBody(fields: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) params.set(key, value);
  }
  return params.toString();
}

export function httpBilling(secretKey: string, fetchImpl: FetchLike = fetch): BillingPlatform {
  async function send(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
    const response = await fetchImpl(`https://api.stripe.com${path}`, { ...init, headers });
    const body = await readJson(response);
    if (response.status === 404) throw new ProviderRequestError("Stripe object was not found", 404);
    if (!response.ok) throw new ProviderRequestError(`Stripe request failed (${response.status})`, response.status);
    return { status: response.status, body };
  }

  return {
    async findCustomerId(clientId) {
      const { body } = await send(`/v1/customers/search?query=${encodeURIComponent(`metadata['client_id']:'${clientId}'`)}`, { method: "GET" });
      const data = Array.isArray(body.data) ? body.data : [];
      const first = data[0] as { id?: string } | undefined;
      return first?.id ?? null;
    },
    async createCustomer(input) {
      const { body } = await send("/v1/customers", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: formBody({
          name: input.name,
          email: input.email,
          "metadata[client_id]": input.clientId,
        }),
      });
      return { customerId: String(body.id) };
    },
    async ensurePrice(input: { lookupKey: string; amountCents: number; kind: PriceKind; productName: string; idempotencyKey: string }) {
      const listed = await send(`/v1/prices?lookup_keys[]=${encodeURIComponent(input.lookupKey)}&active=true`, { method: "GET" });
      const data = Array.isArray(listed.body.data) ? listed.body.data : [];
      const current = data[0] as { id?: string; unit_amount?: number } | undefined;
      if (current?.id && current.unit_amount === input.amountCents) return { priceId: current.id };
      const { body } = await send("/v1/prices", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: formBody({
          currency: "usd",
          unit_amount: String(input.amountCents),
          lookup_key: input.lookupKey,
          transfer_lookup_key: current?.id ? "true" : null,
          "product_data[name]": input.productName,
          "recurring[interval]": input.kind === "recurring" || input.kind === "metered_overage" ? "month" : null,
          "recurring[usage_type]": input.kind === "metered_overage" ? "metered" : null,
        }),
      });
      return { priceId: String(body.id) };
    },
    async createCheckout(input) {
      const fields: Record<string, string | null> = {
        mode: "subscription",
        customer: input.customerId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "line_items[0][price]": input.recurringPriceId,
        "line_items[0][quantity]": "1",
        "metadata[client_id]": input.clientId,
        "subscription_data[metadata][client_id]": input.clientId,
      };
      if (input.setupPriceId) {
        fields["line_items[1][price]"] = input.setupPriceId;
        fields["line_items[1][quantity]"] = "1";
      }
      const { body } = await send("/v1/checkout/sessions", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: formBody(fields),
      });
      const expiresSeconds = Number(body.expires_at);
      if (!Number.isFinite(expiresSeconds)) throw new Error("Stripe did not return a checkout expiry.");
      return { sessionId: String(body.id), url: String(body.url), expiresAt: new Date(expiresSeconds * 1000) };
    },
    async cancelAtPeriodEnd(subscriptionId) {
      const { body } = await send(`/v1/subscriptions/${subscriptionId}`, {
        method: "POST",
        body: formBody({ cancel_at_period_end: "true" }),
      });
      return { serviceEndsAt: subscriptionPeriodEnd(body) };
    },
    async cancelNow(subscriptionId) {
      try {
        await send(`/v1/subscriptions/${subscriptionId}`, { method: "DELETE" });
        return "canceled";
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) return "missing";
        throw error;
      }
    },
  };
}
