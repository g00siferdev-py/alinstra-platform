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
  /** Retell built-in tool type. Only `end_call` is used; custom and transfer tools leave this unset. */
  builtin?: "end_call";
};

export const END_CALL_TOOL: PublishedTool = {
  name: "end_call",
  description: "Ends the phone call immediately. Call this right after saying a one-sentence goodbye when the conversation is finished. Do not wait for the caller to hang up.",
  builtin: "end_call",
};

/** Per-client call timing chosen on the Coverage step. */
export type CallTiming = { maxCallMinutes: number; silenceSeconds: number; reminderSeconds: number };

export const CALL_TIMING_DEFAULTS: CallTiming = { maxCallMinutes: 15, silenceSeconds: 30, reminderSeconds: 8 };

/** What the wizard lets an admin pick. Narrower than Retell's own limits. */
export const CALL_TIMING_LIMITS = {
  maxCallMinutes: { min: 1, max: 60 },
  silenceSeconds: { min: 10, max: 300 },
  reminderSeconds: { min: 5, max: 60 },
} as const;

/** Retell hard limits, enforced again right before the payload leaves. */
const RETELL_LIMITS = {
  max_call_duration_ms: { min: 60_000, max: 7_200_000 },
  end_call_after_silence_ms: { min: 10_000, max: 3_600_000 },
  reminder_trigger_ms: { min: 1_000, max: 600_000 },
} as const;

export type RetellTiming = {
  max_call_duration_ms: number;
  end_call_after_silence_ms: number;
  reminder_trigger_ms: number;
  reminder_max_count: 1;
};

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Maps call timing onto Retell agent fields, falling back to defaults and clamping to Retell's limits. */
export function retellTiming(timing?: Partial<CallTiming> | null): RetellTiming {
  const minutes = timing?.maxCallMinutes ?? CALL_TIMING_DEFAULTS.maxCallMinutes;
  const silence = timing?.silenceSeconds ?? CALL_TIMING_DEFAULTS.silenceSeconds;
  const reminder = timing?.reminderSeconds ?? CALL_TIMING_DEFAULTS.reminderSeconds;
  return {
    max_call_duration_ms: clamp(minutes * 60_000, RETELL_LIMITS.max_call_duration_ms),
    end_call_after_silence_ms: clamp(silence * 1_000, RETELL_LIMITS.end_call_after_silence_ms),
    reminder_trigger_ms: clamp(reminder * 1_000, RETELL_LIMITS.reminder_trigger_ms),
    reminder_max_count: 1,
  };
}

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
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description: "The name of the person or desk to transfer to. It must be one of the targets listed in this tool's description, spelled the same way.",
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
  timing?: CallTiming | null;
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
  createAgent(input: { clientId: string; llmId: string; voiceId: string; webhookUrl: string; timing?: CallTiming | null }): Promise<{ agentId: string }>;
  findNumber(clientId: string): Promise<string | null>;
  createNumber(input: NumberRequest): Promise<{ e164: string }>;
  syncAgent(input: AgentPublish): Promise<{ version: number }>;
  deleteNumber(e164: string): Promise<"deleted" | "missing">;
  deleteAgent(agentId: string): Promise<"deleted" | "missing">;
  deleteLlm(llmId: string): Promise<"deleted" | "missing">;
  /**
   * Downloads the call recording for a finished call. The provider URL is resolved inside the
   * platform and never returned, so nothing outside this call sees it. `null` when the call has no recording.
   */
  fetchRecording(retellCallId: string): Promise<RecordingDownload | null>;
}

export type RecordingDownload = { bytes: Buffer; contentType: string };

/** Recordings larger than this are refused rather than buffered. 15 minutes of 16-bit 8 kHz stereo wav is ~29 MB. */
export const RECORDING_MAX_BYTES = 64 * 1024 * 1024;

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

/** OpenAI-compatible chat completion (OpenRouter, Ollama Cloud, OpenAI, Anthropic compatible, etc.). */
export type TextCompleteInput = {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  /** When true, request JSON and retry/extract until the response parses as an object. */
  json?: boolean;
};

export type TextCompleteResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export interface TextPlatform {
  complete(input: TextCompleteInput): Promise<TextCompleteResult>;
}

/** Default per-interview token budgets. Interview engine enforces these. */
export const DEFAULT_TEXT_TOKEN_BUDGET = {
  inputTokens: 60_000,
  outputTokens: 12_000,
} as const;

export const DEFAULT_TEXT_API_BASE = "https://openrouter.ai/api/v1";
export const DEFAULT_TEXT_MODEL = "moonshotai/kimi-k2.5";

export const TEXT_BUDGET_EXCEEDED_MESSAGE =
  "We've hit the interview's usage limit for now. Finish with what's captured, or ask an admin to raise the budget.";
