import { CHECKOUT_PAYMENT_METHOD_TYPES, retellTiming, STRIPE_PRODUCT_TAX_CODE, type AgentPublish, type BillingPlatform, type CallTiming, type CreateCheckoutInput, type CreatePortalSessionInput, type EnsurePriceInput, type ListInvoicesInput, type PriceKind, type PublishedTool, type RecordingDownload, type ReportMeterEventInput, type RetellCallSnapshot, type RetellTiming, type StripeInvoiceSummary, type SubscriptionPeriodBounds, type UpdateSubscriptionPricesInput, type VoicePlatform } from "./types";

type StoredLlm = { clientId: string; prompt: string; tools: PublishedTool[]; beginMessage: string };
/** Mirrors what httpVoice sends: the agent carries the clamped Retell timing fields. */
type StoredAgent = { clientId: string; llmId: string; voiceId: string; timing: RetellTiming };
type StoredNumber = { clientId: string; agentId: string; e164: string };

export class MemoryVoice implements VoicePlatform {
  llms = new Map<string, StoredLlm>();
  agents = new Map<string, StoredAgent>();
  numbers = new Map<string, StoredNumber>();
  creates = { llm: 0, agent: 0, number: 0, sync: 0 };
  missingDeletes = new Set<string>();
  failSync = false;
  version = 0;
  /** Fake recordings by call id; tests seed these. */
  recordings = new Map<string, Buffer>();
  recordingFetches = 0;
  /** Number of upcoming fetchRecording calls that should throw. */
  recordingFailures = 0;
  /** Fake Retell call snapshots by call id; tests seed these. Missing → null (not found). */
  calls = new Map<string, RetellCallSnapshot>();
  getCallFetches = 0;

  async createLlm(input: { clientId: string; prompt: string; beginMessage: string; tools: PublishedTool[] }): Promise<{ llmId: string }> {
    this.creates.llm += 1;
    const llmId = `llm_${input.clientId}`;
    this.llms.set(llmId, input);
    return { llmId };
  }

  async findAgentId(clientId: string): Promise<string | null> {
    for (const [id, row] of this.agents) if (row.clientId === clientId) return id;
    return null;
  }

  async createAgent(input: { clientId: string; llmId: string; voiceId: string; webhookUrl: string; timing?: CallTiming | null }): Promise<{ agentId: string }> {
    this.creates.agent += 1;
    const agentId = `agent_${input.clientId}`;
    this.agents.set(agentId, { clientId: input.clientId, llmId: input.llmId, voiceId: input.voiceId, timing: retellTiming(input.timing) });
    return { agentId };
  }

  async findNumber(clientId: string): Promise<string | null> {
    for (const row of this.numbers.values()) if (row.clientId === clientId) return row.e164;
    return null;
  }

  async createNumber(input: { clientId: string; agentId: string; inboundWebhookUrl: string; tollFree: boolean; areaCode: number | null }): Promise<{ e164: string }> {
    this.creates.number += 1;
    const e164 = `+1555000${String(this.creates.number).padStart(4, "0")}`;
    this.numbers.set(e164, { ...input, e164 });
    return { e164 };
  }

  async syncAgent(input: AgentPublish): Promise<{ version: number }> {
    this.creates.sync += 1;
    if (this.failSync) throw new Error("Retell sync failed");
    const llm = this.llms.get(input.llmId);
    if (!llm) throw new Error("Missing LLM");
    llm.prompt = input.prompt;
    llm.tools = input.tools;
    llm.beginMessage = input.beginMessage;
    const agent = this.agents.get(input.agentId);
    if (agent) {
      agent.voiceId = input.voiceId;
      agent.timing = retellTiming(input.timing);
    }
    this.version += 1;
    return { version: this.version };
  }

  async deleteNumber(e164: string): Promise<"deleted" | "missing"> {
    if (this.missingDeletes.has(e164) || !this.numbers.has(e164)) return "missing";
    this.numbers.delete(e164);
    return "deleted";
  }

  async deleteAgent(agentId: string): Promise<"deleted" | "missing"> {
    if (this.missingDeletes.has(agentId) || !this.agents.has(agentId)) return "missing";
    this.agents.delete(agentId);
    return "deleted";
  }

  async deleteLlm(llmId: string): Promise<"deleted" | "missing"> {
    if (this.missingDeletes.has(llmId) || !this.llms.has(llmId)) return "missing";
    this.llms.delete(llmId);
    return "deleted";
  }

  async fetchRecording(retellCallId: string): Promise<RecordingDownload | null> {
    this.recordingFetches += 1;
    if (this.recordingFailures > 0) {
      this.recordingFailures -= 1;
      throw new Error("Recording download failed (503)");
    }
    const bytes = this.recordings.get(retellCallId);
    return bytes ? { bytes, contentType: "audio/wav" } : null;
  }

  async getCall(retellCallId: string): Promise<RetellCallSnapshot | null> {
    this.getCallFetches += 1;
    return this.calls.get(retellCallId) ?? null;
  }
}

export class MemoryBilling implements BillingPlatform {
  customers = new Map<string, string>();
  prices = new Map<
    string,
    {
      priceId: string;
      amountCents: number;
      kind: PriceKind;
      meterId?: string;
      includedMinutes?: number;
      taxBehavior: "exclusive" | "inclusive" | "unspecified";
      taxCode: string;
    }
  >();
  meters = new Map<string, string>();
  meterEvents: Array<ReportMeterEventInput & { reportedAt: Date }> = [];
  /** Next reportMeterEvent calls that should throw (for retry tests). */
  meterEventFailures = 0;
  checkouts = new Map<string, { url: string; subscriptionId: string }>();
  lastCheckout: {
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
    recurringPriceId: string;
    setupPriceId: string | null;
    meteredPriceId: string | null;
    clientId: string;
    customerUpdateAddress: "auto";
    customerUpdateName: false;
    paymentMethodTypes: readonly string[];
    taxIdCollection: false;
  } | null = null;
  canceled = new Set<string>();
  periodEnd = new Map<string, Date>();
  periodStart = new Map<string, Date>();
  subscriptionItems = new Map<string, { recurringPriceId: string; meteredPriceId: string | null }>();
  portalSessions: Array<{ customerId: string; returnUrl: string; url: string }> = [];
  lastPriceUpdate: UpdateSubscriptionPricesInput | null = null;
  /** Fake invoices keyed by subscription id (tests seed drafts to void on resume). */
  invoices = new Map<string, StripeInvoiceSummary[]>();
  voidedInvoiceIds: string[] = [];
  creates = { customer: 0, price: 0, checkout: 0, meter: 0, meterEvent: 0, portal: 0, voidInvoice: 0 };

  async findCustomerId(clientId: string): Promise<string | null> {
    return this.customers.get(clientId) ?? null;
  }

  async createCustomer(input: { clientId: string; name: string; email: string | null; idempotencyKey: string }): Promise<{ customerId: string }> {
    const existing = this.customers.get(input.clientId);
    if (existing) return { customerId: existing };
    this.creates.customer += 1;
    const customerId = `cus_${input.clientId}`;
    this.customers.set(input.clientId, customerId);
    return { customerId };
  }

  async ensureMeter(input: { eventName: string; displayName: string; idempotencyKey: string }): Promise<{ meterId: string }> {
    const existing = this.meters.get(input.eventName);
    if (existing) return { meterId: existing };
    this.creates.meter += 1;
    const meterId = `mtr_${input.eventName}`;
    this.meters.set(input.eventName, meterId);
    return { meterId };
  }

  async ensurePrice(input: EnsurePriceInput): Promise<{ priceId: string; taxBehaviorUpdated: boolean }> {
    const current = this.prices.get(input.lookupKey);
    if (input.kind === "metered_overage") {
      const included = input.includedMinutes ?? 0;
      const overage = input.overagePerMinuteCents ?? input.amountCents;
      if (current && current.kind === input.kind && current.amountCents === overage && current.includedMinutes === included && current.meterId === input.meterId) {
        const taxBehaviorUpdated = current.taxBehavior === "unspecified";
        if (taxBehaviorUpdated) {
          current.taxBehavior = "exclusive";
          current.taxCode = STRIPE_PRODUCT_TAX_CODE;
        }
        return { priceId: current.priceId, taxBehaviorUpdated };
      }
      this.creates.price += 1;
      const priceId = `price_${input.lookupKey}`;
      this.prices.set(input.lookupKey, {
        priceId,
        amountCents: overage,
        kind: input.kind,
        meterId: input.meterId,
        includedMinutes: included,
        taxBehavior: "exclusive",
        taxCode: STRIPE_PRODUCT_TAX_CODE,
      });
      return { priceId, taxBehaviorUpdated: false };
    }
    if (current && current.amountCents === input.amountCents && current.kind === input.kind) {
      const taxBehaviorUpdated = current.taxBehavior === "unspecified";
      if (taxBehaviorUpdated) {
        current.taxBehavior = "exclusive";
        current.taxCode = STRIPE_PRODUCT_TAX_CODE;
      }
      return { priceId: current.priceId, taxBehaviorUpdated };
    }
    this.creates.price += 1;
    const priceId = `price_${input.lookupKey}_${input.amountCents}`;
    this.prices.set(input.lookupKey, {
      priceId,
      amountCents: input.amountCents,
      kind: input.kind,
      taxBehavior: "exclusive",
      taxCode: STRIPE_PRODUCT_TAX_CODE,
    });
    return { priceId, taxBehaviorUpdated: false };
  }

  async reportMeterEvent(input: ReportMeterEventInput): Promise<{ identifier: string }> {
    if (this.meterEventFailures > 0) {
      this.meterEventFailures -= 1;
      throw new Error("meter event failed");
    }
    const duplicate = this.meterEvents.find((row) => row.identifier === input.identifier);
    if (duplicate) return { identifier: input.identifier };
    this.creates.meterEvent += 1;
    this.meterEvents.push({ ...input, reportedAt: new Date() });
    return { identifier: input.identifier };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<{ sessionId: string; url: string; expiresAt: Date }> {
    this.lastCheckout = {
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey: input.idempotencyKey,
      recurringPriceId: input.recurringPriceId,
      setupPriceId: input.setupPriceId,
      meteredPriceId: input.meteredPriceId ?? null,
      clientId: input.clientId,
      customerUpdateAddress: "auto",
      customerUpdateName: false,
      paymentMethodTypes: [...CHECKOUT_PAYMENT_METHOD_TYPES],
      taxIdCollection: false,
    };
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existing = this.checkouts.get(input.idempotencyKey);
    if (existing) return { sessionId: `cs_${input.clientId}`, url: existing.url, expiresAt };
    this.creates.checkout += 1;
    const url = `https://checkout.stripe.test/${input.clientId}/${this.creates.checkout}`;
    const subscriptionId = `sub_${input.clientId}`;
    this.checkouts.set(input.idempotencyKey, { url, subscriptionId });
    const start = new Date();
    const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    this.periodStart.set(subscriptionId, start);
    this.periodEnd.set(subscriptionId, end);
    this.subscriptionItems.set(subscriptionId, {
      recurringPriceId: input.recurringPriceId,
      meteredPriceId: input.meteredPriceId ?? null,
    });
    return { sessionId: `cs_${input.clientId}`, url, expiresAt };
  }

  async createPortalSession(input: CreatePortalSessionInput): Promise<{ url: string }> {
    this.creates.portal += 1;
    const url = `https://billing.stripe.test/session/${input.customerId}/${this.creates.portal}`;
    this.portalSessions.push({ customerId: input.customerId, returnUrl: input.returnUrl, url });
    return { url };
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionPeriodBounds> {
    const start = this.periodStart.get(subscriptionId) ?? new Date();
    const end = this.periodEnd.get(subscriptionId) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return { currentPeriodStart: start, currentPeriodEnd: end };
  }

  async listInvoices(input: ListInvoicesInput): Promise<StripeInvoiceSummary[]> {
    return (this.invoices.get(input.subscriptionId) ?? []).filter((row) => row.status === input.status);
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    this.creates.voidInvoice += 1;
    this.voidedInvoiceIds.push(invoiceId);
    for (const [subscriptionId, rows] of this.invoices) {
      this.invoices.set(
        subscriptionId,
        rows.map((row) => (row.id === invoiceId ? { ...row, status: "void" } : row)),
      );
    }
  }

  async updateSubscriptionPrices(input: UpdateSubscriptionPricesInput): Promise<SubscriptionPeriodBounds> {
    this.lastPriceUpdate = input;
    const start = this.periodStart.get(input.subscriptionId) ?? new Date();
    const end = this.periodEnd.get(input.subscriptionId) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    this.subscriptionItems.set(input.subscriptionId, {
      recurringPriceId: input.recurringPriceId,
      meteredPriceId: input.meteredPriceId,
    });
    this.periodStart.set(input.subscriptionId, start);
    this.periodEnd.set(input.subscriptionId, end);
    return { currentPeriodStart: start, currentPeriodEnd: end };
  }

  subscriptionFor(clientId: string): string {
    return `sub_${clientId}`;
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<{ serviceEndsAt: Date }> {
    const ends = this.periodEnd.get(subscriptionId) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    this.periodEnd.set(subscriptionId, ends);
    return { serviceEndsAt: ends };
  }

  async cancelNow(subscriptionId: string): Promise<"canceled" | "missing"> {
    if (this.canceled.has(subscriptionId)) return "missing";
    this.canceled.add(subscriptionId);
    return "canceled";
  }
}
