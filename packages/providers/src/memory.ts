import { retellTiming, type AgentPublish, type BillingPlatform, type CallTiming, type PriceKind, type PublishedTool, type RetellTiming, type VoicePlatform } from "./types";

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
}

export class MemoryBilling implements BillingPlatform {
  customers = new Map<string, string>();
  prices = new Map<string, { priceId: string; amountCents: number; kind: PriceKind }>();
  checkouts = new Map<string, { url: string; subscriptionId: string }>();
  lastCheckout: { successUrl: string; cancelUrl: string; idempotencyKey: string } | null = null;
  canceled = new Set<string>();
  periodEnd = new Map<string, Date>();
  creates = { customer: 0, price: 0, checkout: 0 };

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

  async ensurePrice(input: { lookupKey: string; amountCents: number; kind: PriceKind; productName: string; idempotencyKey: string }): Promise<{ priceId: string }> {
    const current = this.prices.get(input.lookupKey);
    if (current && current.amountCents === input.amountCents && current.kind === input.kind) return { priceId: current.priceId };
    this.creates.price += 1;
    const priceId = `price_${input.lookupKey}_${input.amountCents}`;
    this.prices.set(input.lookupKey, { priceId, amountCents: input.amountCents, kind: input.kind });
    return { priceId };
  }

  async createCheckout(input: {
    clientId: string;
    customerId: string;
    recurringPriceId: string;
    setupPriceId: string | null;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; url: string; expiresAt: Date }> {
    this.lastCheckout = { successUrl: input.successUrl, cancelUrl: input.cancelUrl, idempotencyKey: input.idempotencyKey };
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existing = this.checkouts.get(input.idempotencyKey);
    if (existing) return { sessionId: `cs_${input.clientId}`, url: existing.url, expiresAt };
    this.creates.checkout += 1;
    const url = `https://checkout.stripe.test/${input.clientId}/${this.creates.checkout}`;
    const subscriptionId = `sub_${input.clientId}`;
    this.checkouts.set(input.idempotencyKey, { url, subscriptionId });
    this.periodEnd.set(subscriptionId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    return { sessionId: `cs_${input.clientId}`, url, expiresAt };
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
