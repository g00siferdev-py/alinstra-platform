export { checkRetellHealth, checkStripeHealth, type ServiceHealth } from "./health";
export { httpBilling, httpVoice } from "./http";
export { platformsFor, type PlatformsEnv } from "./local";
export { MemoryBilling, MemoryVoice } from "./memory";
export { memoryText, type MemoryTextReply } from "./memory-text";
export { signRetell, signStripe, verifyRetell, verifyStripe } from "./signature";
export { extractJsonObject, httpText, parseJsonObject, type HttpTextOptions } from "./text";
export { transferSlug, transferToolNames } from "./transfer";
export {
  DEFAULT_VOICE_KEY,
  isVoiceKey,
  retellVoiceIdFor,
  VOICE_KEYS,
  VOICE_OPTIONS,
  voiceDisplayName,
  voiceOption,
  type VoiceKey,
  type VoiceOption,
} from "./voices";
export {
  CALL_TIMING_DEFAULTS,
  CALL_TIMING_LIMITS,
  DEFAULT_TEXT_API_BASE,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TEXT_TOKEN_BUDGET,
  END_CALL_TOOL,
  ProviderRequestError,
  RECORDING_MAX_BYTES,
  retellTiming,
  STRIPE_API_VERSION,
  TAKE_MESSAGE_PARAMETERS,
  TEXT_BUDGET_EXCEEDED_MESSAGE,
  TRANSFER_CHECK_PARAMETERS,
  type AgentPublish,
  type BillingPlatform,
  type CallTiming,
  type NumberRequest,
  type PriceKind,
  type PublishedTool,
  type RecordingDownload,
  type RetellCallSnapshot,
  type RetellTiming,
  type TextCompleteInput,
  type TextCompleteResult,
  type TextPlatform,
  type ToolParameters,
  type VoicePlatform,
} from "./types";

export function overageLookupKey(planCode: string): string {
  return `plan_${planCode}_overage`;
}
