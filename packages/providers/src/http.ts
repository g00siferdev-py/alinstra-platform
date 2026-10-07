import { ProviderRequestError, RECORDING_MAX_BYTES, retellTiming, STRIPE_API_VERSION, STRIPE_PRODUCT_TAX_CODE, type AgentPublish, type BillingPlatform, type EnsurePriceInput, type PublishedTool, type ReportMeterEventInput, type RetellCallSnapshot, type UpdateSubscriptionPricesInput, type VoicePlatform } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const RETELL = "https://api.retellai.com";

const DEFAULT_DYNAMIC_VARIABLES = {
  office_open: "unknown",
  allowed_targets: "",
};

function toolsOf(tools: PublishedTool[]): unknown[] {
  return tools.map((tool) => {
    if (tool.builtin === "end_call") {
      return { type: "end_call", name: tool.name, description: tool.description };
    }
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
  return subscriptionPeriodBounds(body, now).currentPeriodEnd;
}

/** Period start/end from subscription items (basil+ shape). Uses the max end and matching start. */
export function subscriptionPeriodBounds(body: Record<string, unknown>, now = Date.now()): { currentPeriodStart: Date; currentPeriodEnd: Date } {
  const items = body.items as { data?: Array<{ current_period_start?: unknown; current_period_end?: unknown }> } | undefined;
  const rows = (items?.data ?? [])
    .map((item) => ({
      start: Number(item.current_period_start),
      end: Number(item.current_period_end),
    }))
    .filter((row) => Number.isFinite(row.end));
  if (rows.length === 0) throw new Error("Stripe did not return a subscription item period end. Nothing was saved.");
  const chosen = rows.reduce((best, row) => (row.end >= best.end ? row : best));
  const endsAt = new Date(chosen.end * 1000);
  if (!(endsAt.getTime() > now)) throw new Error("Stripe period end is not in the future. Nothing was saved.");
  const startSeconds = Number.isFinite(chosen.start) && chosen.start > 0 ? chosen.start : chosen.end - 30 * 24 * 60 * 60;
  return { currentPeriodStart: new Date(startSeconds * 1000), currentPeriodEnd: endsAt };
}

function redactSecrets(value: string, secrets: string[]): string {
  let out = value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted]");
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerDetail(json: Record<string, unknown> | null, text: string, secrets: string[]): string {
  const error = json?.error;
  const nested = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const detail = stringField(json?.message)
    ?? stringField(error)
    ?? stringField(json?.error_message)
    ?? stringField(nested?.message)
    ?? stringField(nested?.error_message)
    ?? text.trim();
  const clipped = redactSecrets(detail, secrets).slice(0, 500);
  return clipped || "empty response";
}

async function readBody(response: Response): Promise<{ json: Record<string, unknown> | null; text: string }> {
  if (response.status === 204) return { json: {}, text: "" };
  const text = await response.text();
  if (!text) return { json: {}, text: "" };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { json: parsed as Record<string, unknown>, text };
    }
  } catch {
    return { json: null, text };
  }
  return { json: null, text };
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
    const { json, text } = await readBody(response);
    if (response.status === 404) throw new ProviderRequestError("Retell object was not found", 404);
    if (!response.ok) {
      throw new ProviderRequestError(`Retell request failed (${response.status}): ${providerDetail(json, text, [apiKey])}`, response.status);
    }
    return { status: response.status, body: json ?? {} };
  }

  const voice: VoicePlatform = {
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
          ...retellTiming(input.timing),
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
          inbound_agents: [{ agent_id: input.agentId, weight: 1 }],
          inbound_webhook_url: input.inboundWebhookUrl,
          nickname: `alinstra-${input.clientId}`,
          allowed_outbound_country_list: ["US", "CA"],
          ...(input.tollFree
            ? { toll_free: true, number_provider: "twilio", country_code: "US" }
            : input.areaCode ? { area_code: input.areaCode } : {}),
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
          ...retellTiming(input.timing),
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
    async getCall(retellCallId) {
      try {
        const { body } = await send(`/v2/get-call/${encodeURIComponent(retellCallId)}`, { method: "GET" });
        const callId = typeof body.call_id === "string" ? body.call_id : retellCallId;
        return { ...body, call_id: callId } as RetellCallSnapshot;
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) return null;
        throw error;
      }
    },
    async fetchRecording(retellCallId) {
      // GET /v2/get-call/{call_id} returns `recording_url` (https://docs.retellai.com/api-references/get-call).
      // The URL stays inside this function: it is fetched and the bytes are returned, nothing else.
      const call = await voice.getCall(retellCallId);
      if (!call) return null;
      const url = typeof call.recording_url === "string" ? call.recording_url : "";
      if (!url) return null;
      const response = await fetchImpl(url, { method: "GET" });
      if (!response.ok) throw new ProviderRequestError(`Recording download failed (${response.status})`, response.status);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > RECORDING_MAX_BYTES) throw new Error(`Recording is too large (${declared} bytes)`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > RECORDING_MAX_BYTES) throw new Error(`Recording is too large (${bytes.length} bytes)`);
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() || "audio/wav";
      return { bytes, contentType };
    },
  };
  return voice;
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
    const { json, text } = await readBody(response);
    if (response.status === 404) throw new ProviderRequestError("Stripe object was not found", 404);
    if (!response.ok) {
      throw new ProviderRequestError(`Stripe request failed (${response.status}): ${providerDetail(json, text, [secretKey])}`, response.status);
    }
    return { status: response.status, body: json ?? {} };
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
    async ensureMeter(input) {
      const listed = await send("/v1/billing/meters?limit=100", { method: "GET" });
      const data = Array.isArray(listed.body.data) ? listed.body.data : [];
      const existing = data.find((row) => {
        const meter = row as { id?: string; event_name?: string; status?: string };
        return meter.event_name === input.eventName && meter.status !== "inactive";
      }) as { id?: string } | undefined;
      if (existing?.id) return { meterId: existing.id };
      const { body } = await send("/v1/billing/meters", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: formBody({
          display_name: input.displayName,
          event_name: input.eventName,
          "default_aggregation[formula]": "sum",
          "customer_mapping[event_payload_key]": "stripe_customer_id",
          "customer_mapping[type]": "by_id",
          "value_settings[event_payload_key]": "value",
        }),
      });
      return { meterId: String(body.id) };
    },
    async ensurePrice(input: EnsurePriceInput) {
      const listed = await send(`/v1/prices?lookup_keys[]=${encodeURIComponent(input.lookupKey)}&active=true`, { method: "GET" });
      const data = Array.isArray(listed.body.data) ? listed.body.data : [];
      const current = data[0] as {
        id?: string;
        unit_amount?: number | null;
        billing_scheme?: string;
        tax_behavior?: string | null;
        product?: string | { id?: string };
      } | undefined;

      async function patchTaxIfNeeded(price: NonNullable<typeof current>): Promise<boolean> {
        const productId =
          typeof price.product === "string"
            ? price.product
            : price.product && typeof price.product === "object" && typeof price.product.id === "string"
              ? price.product.id
              : null;
        if (productId) {
          await send(`/v1/products/${encodeURIComponent(productId)}`, {
            method: "POST",
            body: formBody({ tax_code: STRIPE_PRODUCT_TAX_CODE }),
          });
        }
        const behavior = price.tax_behavior ?? "unspecified";
        if (behavior === "exclusive" || behavior === "inclusive") return false;
        if (!price.id) return false;
        // Stripe allows unspecified → exclusive once.
        await send(`/v1/prices/${encodeURIComponent(price.id)}`, {
          method: "POST",
          body: formBody({ tax_behavior: "exclusive" }),
        });
        return true;
      }

      if (input.kind === "metered_overage") {
        // Lookup key encodes included + overage amounts; an active row with that key is the current price.
        if (current?.id) {
          const taxBehaviorUpdated = await patchTaxIfNeeded(current);
          return { priceId: current.id, taxBehaviorUpdated };
        }
        if (!input.meterId) throw new Error("meterId is required for metered_overage prices.");
        const included = input.includedMinutes ?? 0;
        const overage = input.overagePerMinuteCents ?? input.amountCents;
        const { body } = await send("/v1/prices", {
          method: "POST",
          idempotencyKey: input.idempotencyKey,
          body: formBody({
            currency: "usd",
            lookup_key: input.lookupKey,
            tax_behavior: "exclusive",
            "product_data[name]": input.productName,
            "product_data[tax_code]": STRIPE_PRODUCT_TAX_CODE,
            billing_scheme: "tiered",
            tiers_mode: "graduated",
            "recurring[interval]": "month",
            "recurring[usage_type]": "metered",
            "recurring[meter]": input.meterId,
            "tiers[0][up_to]": String(included),
            "tiers[0][unit_amount]": "0",
            "tiers[1][up_to]": "inf",
            "tiers[1][unit_amount]": String(overage),
          }),
        });
        return { priceId: String(body.id), taxBehaviorUpdated: false };
      }
      if (current?.id && current.unit_amount === input.amountCents) {
        const taxBehaviorUpdated = await patchTaxIfNeeded(current);
        return { priceId: current.id, taxBehaviorUpdated };
      }
      const { body } = await send("/v1/prices", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: formBody({
          currency: "usd",
          unit_amount: String(input.amountCents),
          lookup_key: input.lookupKey,
          tax_behavior: "exclusive",
          transfer_lookup_key: current?.id ? "true" : null,
          "product_data[name]": input.productName,
          "product_data[tax_code]": STRIPE_PRODUCT_TAX_CODE,
          "recurring[interval]": input.kind === "recurring" ? "month" : null,
        }),
      });
      return { priceId: String(body.id), taxBehaviorUpdated: false };
    },
    async reportMeterEvent(input: ReportMeterEventInput) {
      const { body } = await send("/v1/billing/meter_events", {
        method: "POST",
        body: formBody({
          event_name: input.eventName,
          identifier: input.identifier,
          timestamp: String(Math.floor(input.timestamp.getTime() / 1000)),
          "payload[stripe_customer_id]": input.customerId,
          "payload[value]": String(input.value),
        }),
      });
      return { identifier: String(body.identifier ?? input.identifier) };
    },
    async createCheckout(input) {
      const lineItems: Array<{ price: string; quantity?: string }> = [
        { price: input.recurringPriceId, quantity: "1" },
      ];
      if (input.meteredPriceId) {
        // Metered prices have no quantity (usage reported later).
        lineItems.push({ price: input.meteredPriceId });
      }
      if (input.setupPriceId) {
        lineItems.push({ price: input.setupPriceId, quantity: "1" });
      }
      const fields: Record<string, string | null> = {
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.clientId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "automatic_tax[enabled]": "true",
        billing_address_collection: "required",
        // Existing Customer: Checkout must write the collected address/name back so Tax can use them.
        "customer_update[address]": "auto",
        "customer_update[name]": "auto",
        "metadata[client_id]": input.clientId,
        "subscription_data[metadata][client_id]": input.clientId,
      };
      lineItems.forEach((item, index) => {
        fields[`line_items[${index}][price]`] = item.price;
        if (item.quantity) fields[`line_items[${index}][quantity]`] = item.quantity;
      });
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
    async createPortalSession(input) {
      const { body } = await send("/v1/billing/portal/sessions", {
        method: "POST",
        body: formBody({
          customer: input.customerId,
          return_url: input.returnUrl,
        }),
      });
      return { url: String(body.url) };
    },
    async getSubscription(subscriptionId) {
      const { body } = await send(`/v1/subscriptions/${subscriptionId}?expand[]=items.data.price`, { method: "GET" });
      return subscriptionPeriodBounds(body);
    },
    async listInvoices(input) {
      const params = new URLSearchParams({
        subscription: input.subscriptionId,
        status: input.status,
        limit: "100",
      });
      const { body } = await send(`/v1/invoices?${params.toString()}`, { method: "GET" });
      const rows = Array.isArray(body.data) ? body.data : [];
      return rows.flatMap((row) => {
        const invoice = row as { id?: unknown; created?: unknown; status?: unknown };
        if (typeof invoice.id !== "string") return [];
        const createdSeconds = Number(invoice.created);
        return [
          {
            id: invoice.id,
            created: Number.isFinite(createdSeconds) ? new Date(createdSeconds * 1000) : new Date(0),
            status: typeof invoice.status === "string" ? invoice.status : input.status,
          },
        ];
      });
    },
    async voidInvoice(invoiceId) {
      await send(`/v1/invoices/${encodeURIComponent(invoiceId)}/void`, {
        method: "POST",
        body: formBody({}),
      });
    },
    async updateSubscriptionPrices(input: UpdateSubscriptionPricesInput) {
      const listed = await send(`/v1/subscriptions/${input.subscriptionId}?expand[]=items.data.price`, { method: "GET" });
      const items = Array.isArray((listed.body.items as { data?: unknown[] } | undefined)?.data)
        ? ((listed.body.items as { data: Array<Record<string, unknown>> }).data)
        : [];
      const fields: Record<string, string | null> = {
        proration_behavior: input.prorationBehavior,
      };
      let index = 0;
      let sawRecurring = false;
      let sawMetered = false;
      for (const item of items) {
        const itemId = typeof item.id === "string" ? item.id : "";
        if (!itemId) continue;
        const price = item.price && typeof item.price === "object" ? (item.price as Record<string, unknown>) : {};
        const recurring = price.recurring && typeof price.recurring === "object" ? (price.recurring as Record<string, unknown>) : {};
        const usageType = typeof recurring.usage_type === "string" ? recurring.usage_type : "";
        const isMetered = usageType === "metered" || price.billing_scheme === "tiered";
        fields[`items[${index}][id]`] = itemId;
        if (isMetered) {
          sawMetered = true;
          if (input.meteredPriceId) {
            fields[`items[${index}][price]`] = input.meteredPriceId;
          } else {
            fields[`items[${index}][deleted]`] = "true";
          }
        } else {
          sawRecurring = true;
          fields[`items[${index}][price]`] = input.recurringPriceId;
          fields[`items[${index}][quantity]`] = "1";
        }
        index += 1;
      }
      if (!sawRecurring) {
        fields[`items[${index}][price]`] = input.recurringPriceId;
        fields[`items[${index}][quantity]`] = "1";
        index += 1;
      }
      if (input.meteredPriceId && !sawMetered) {
        fields[`items[${index}][price]`] = input.meteredPriceId;
      }
      const { body } = await send(`/v1/subscriptions/${input.subscriptionId}`, {
        method: "POST",
        body: formBody(fields),
      });
      return subscriptionPeriodBounds(body);
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
