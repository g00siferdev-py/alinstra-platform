export type PublishedTool = {
  name: string;
  description: string;
  url?: string;
  timeoutMs?: number;
  transferTo?: string;
};

export type AgentPublish = {
  clientId: string;
  llmId: string;
  agentId: string;
  prompt: string;
  beginMessage: string;
  voiceId: string;
  tools: PublishedTool[];
  webhookUrl: string;
  inboundWebhookUrl: string;
};

export interface VoicePlatform {
  findLlmId(clientId: string): Promise<string | null>;
  createLlm(input: { clientId: string; prompt: string; beginMessage: string; tools: PublishedTool[] }): Promise<{ llmId: string }>;
  findAgentId(clientId: string): Promise<string | null>;
  createAgent(input: { clientId: string; llmId: string; voiceId: string; webhookUrl: string }): Promise<{ agentId: string }>;
  findNumber(clientId: string): Promise<string | null>;
  createNumber(input: { clientId: string; agentId: string; inboundWebhookUrl: string }): Promise<{ e164: string }>;
  syncAgent(input: AgentPublish): Promise<{ version: number }>;
  deleteNumber(e164: string): Promise<"deleted" | "missing">;
  deleteAgent(agentId: string): Promise<"deleted" | "missing">;
  deleteLlm(llmId: string): Promise<"deleted" | "missing">;
}

export type PriceKind = "recurring" | "setup" | "metered_overage";

export interface BillingPlatform {
  findCustomerId(clientId: string): Promise<string | null>;
  createCustomer(input: { clientId: string; name: string; email: string | null; idempotencyKey: string }): Promise<{ customerId: string }>;
  ensurePrice(input: { lookupKey: string; amountCents: number; kind: PriceKind; productName: string; idempotencyKey: string }): Promise<{ priceId: string }>;
  createCheckout(input: {
    clientId: string;
    customerId: string;
    recurringPriceId: string;
    setupPriceId: string | null;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; url: string }>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<{ serviceEndsAt: Date }>;
  cancelNow(subscriptionId: string): Promise<"canceled" | "missing">;
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}
