export type ToolParameters = {
  type: "object";
  properties: Record<string, { type: "string"; description: string }>;
  required?: string[];
};

export type PublishedTool = {
  name: string;
  description: string;
  url?: string;
  timeoutMs?: number;
  transferTo?: string;
  parameters?: ToolParameters;
};

export const TAKE_MESSAGE_PARAMETERS: ToolParameters = {
  type: "object",
  required: ["message", "callback_number"],
  properties: {
    caller_name: {
      type: "string",
      description: "The caller's name. Ask for it if they have not given it. You may call this tool without it.",
    },
    callback_number: {
      type: "string",
      description: "The phone number the caller wants called back, as they said it. Ask for it before calling this tool if you do not have it.",
    },
    message: {
      type: "string",
      description: "The message for the office, in the caller's words. Ask for it before calling this tool if you do not have it.",
    },
  },
};

export const TRANSFER_CHECK_PARAMETERS: ToolParameters = {
  type: "object",
  required: ["number"],
  properties: {
    number: {
      type: "string",
      description: "The transfer number in E.164. It must be one of the numbers listed in this tool's description.",
    },
  },
};

export const STRIPE_API_VERSION = "2026-09-30.endive";

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

export type NumberRequest = {
  clientId: string;
  agentId: string;
  inboundWebhookUrl: string;
  tollFree: boolean;
  areaCode: number | null;
};

export interface VoicePlatform {
  createLlm(input: { clientId: string; prompt: string; beginMessage: string; tools: PublishedTool[] }): Promise<{ llmId: string }>;
  findAgentId(clientId: string): Promise<string | null>;
  createAgent(input: { clientId: string; llmId: string; voiceId: string; webhookUrl: string }): Promise<{ agentId: string }>;
  findNumber(clientId: string): Promise<string | null>;
  createNumber(input: NumberRequest): Promise<{ e164: string }>;
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
  }): Promise<{ sessionId: string; url: string; expiresAt: Date }>;
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
