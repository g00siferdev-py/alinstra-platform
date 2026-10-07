export { checkRetellHealth, checkStripeHealth, type ServiceHealth } from "./health";
export { httpBilling, httpVoice, subscriptionPeriodBounds, subscriptionPeriodEnd } from "./http";
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
  METER_EVENT_NAME,
  ProviderRequestError,
  RECORDING_MAX_BYTES,
  retellTiming,
  STRIPE_API_VERSION,
  STRIPE_PRODUCT_TAX_CODE,
  TAKE_MESSAGE_PARAMETERS,
  TEXT_BUDGET_EXCEEDED_MESSAGE,
  TRANSFER_CHECK_PARAMETERS,
  type AgentPublish,
  type BillingPlatform,
  type CallTiming,
  type CreateCheckoutInput,
  type CreatePortalSessionInput,
  type EnsurePriceInput,
  type NumberRequest,
  type PriceKind,
  type PublishedTool,
  type RecordingDownload,
  type ReportMeterEventInput,
  type RetellCallSnapshot,
  type RetellTiming,
  type SubscriptionPeriodBounds,
  type TextCompleteInput,
  type TextCompleteResult,
  type TextPlatform,
  type ToolParameters,
  type UpdateSubscriptionPricesInput,
  type VoicePlatform,
} from "./types";

/**
 * Lookup key for a plan's graduated metered overage price.
 * Includes amounts so ensurePrice is idempotent when included minutes or overage rate change.
 */
export function overageLookupKey(planCode: string, includedMinutes: number, overagePerMinuteCents: number): string {
  return `plan_${planCode}_overage_${includedMinutes}_${overagePerMinuteCents}`;
}

/**
 * Per-client metered price when overrideIncludedMinutes and/or overrideOveragePerMinuteCents is set.
 * Checkout uses this instead of the plan catalog price so custom tiers bill correctly.
 */
export function clientOverageLookupKey(clientId: string, includedMinutes: number, overagePerMinuteCents: number): string {
  return `client_${clientId}_overage_${includedMinutes}_${overagePerMinuteCents}`;
}

/** AppSetting key for the single alinstra_minutes Billing Meter id. */
export const METER_APP_SETTING_KEY = "stripe.meter.alinstra_minutes";
