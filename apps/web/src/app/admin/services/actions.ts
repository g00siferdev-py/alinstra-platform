"use server";

import { getEnv } from "@alinstra/config";
import { checkRetellHealth, checkStripeHealth, type ServiceHealth } from "@alinstra/providers";
import { requireAdmin } from "@/lib/session";

export type CheckableService = "retell" | "stripe";

/** Runs one cheap authenticated read against the named provider. Never returns key material. */
export async function checkServiceAction(service: CheckableService): Promise<ServiceHealth> {
  await requireAdmin();
  const env = getEnv();
  if (service === "retell") return checkRetellHealth(env.RETELL_API_KEY);
  if (service === "stripe") return checkStripeHealth(env.STRIPE_SECRET_KEY);
  return { ok: false, error: "Unknown service." };
}
