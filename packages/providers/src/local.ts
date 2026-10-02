import { httpBilling, httpVoice } from "./http";
import { MemoryBilling, MemoryVoice } from "./memory";
import type { BillingPlatform, VoicePlatform } from "./types";

let memoryVoice: MemoryVoice | undefined;
let memoryBilling: MemoryBilling | undefined;

export function platformsFor(env: { NODE_ENV: string; RETELL_API_KEY: string; STRIPE_SECRET_KEY: string }): {
  voice: VoicePlatform;
  billing: BillingPlatform;
} {
  if (env.RETELL_API_KEY || env.STRIPE_SECRET_KEY) {
    if (!env.RETELL_API_KEY || !env.STRIPE_SECRET_KEY) {
      throw new Error("Set both RETELL_API_KEY and STRIPE_SECRET_KEY, or leave both empty for the local fakes.");
    }
    return { voice: httpVoice(env.RETELL_API_KEY), billing: httpBilling(env.STRIPE_SECRET_KEY) };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("RETELL_API_KEY and STRIPE_SECRET_KEY are required in production");
  }
  memoryVoice ??= new MemoryVoice();
  memoryBilling ??= new MemoryBilling();
  return { voice: memoryVoice, billing: memoryBilling };
}
