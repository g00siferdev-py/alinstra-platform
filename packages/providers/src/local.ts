import { httpBilling, httpVoice } from "./http";
import { MemoryBilling, MemoryVoice } from "./memory";
import { httpText } from "./text";
import {
  DEFAULT_TEXT_API_BASE,
  DEFAULT_TEXT_MODEL,
  type BillingPlatform,
  type TextPlatform,
  type VoicePlatform,
} from "./types";

let memoryVoice: MemoryVoice | undefined;
let memoryBilling: MemoryBilling | undefined;

export type PlatformsEnv = {
  NODE_ENV: string;
  RETELL_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  TEXT_API_KEY?: string;
  TEXT_API_BASE?: string;
  TEXT_MODEL?: string;
  TEXT_FALLBACK_MODEL?: string;
};

export function platformsFor(env: PlatformsEnv): {
  voice: VoicePlatform;
  billing: BillingPlatform;
  /** Null when TEXT_API_KEY is absent — interview UI stays hidden. */
  text: TextPlatform | null;
} {
  const textKey = env.TEXT_API_KEY?.trim() ?? "";
  const text: TextPlatform | null = textKey
    ? httpText({
        apiKey: textKey,
        baseUrl: env.TEXT_API_BASE?.trim() || DEFAULT_TEXT_API_BASE,
        model: env.TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
        fallbackModel: env.TEXT_FALLBACK_MODEL?.trim() || undefined,
      })
    : null;

  if (env.RETELL_API_KEY || env.STRIPE_SECRET_KEY) {
    if (!env.RETELL_API_KEY || !env.STRIPE_SECRET_KEY) {
      throw new Error("Set both RETELL_API_KEY and STRIPE_SECRET_KEY, or leave both empty for the local fakes.");
    }
    return { voice: httpVoice(env.RETELL_API_KEY), billing: httpBilling(env.STRIPE_SECRET_KEY), text };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("RETELL_API_KEY and STRIPE_SECRET_KEY are required in production");
  }
  memoryVoice ??= new MemoryVoice();
  memoryBilling ??= new MemoryBilling();
  return { voice: memoryVoice, billing: memoryBilling, text };
}
