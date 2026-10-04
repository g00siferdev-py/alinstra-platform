export { httpBilling, httpVoice } from "./http";
export { platformsFor } from "./local";
export { MemoryBilling, MemoryVoice } from "./memory";
export { signRetell, signStripe, verifyRetell, verifyStripe } from "./signature";
export { transferSlug, transferToolNames } from "./transfer";
export {
  ProviderRequestError,
  STRIPE_API_VERSION,
  TAKE_MESSAGE_PARAMETERS,
  TRANSFER_CHECK_PARAMETERS,
  type AgentPublish,
  type BillingPlatform,
  type NumberRequest,
  type PriceKind,
  type PublishedTool,
  type ToolParameters,
  type VoicePlatform,
} from "./types";

export function overageLookupKey(planCode: string): string {
  return `plan_${planCode}_overage`;
}
