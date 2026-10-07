/**
 * Phase B Part 3: create/refresh Stripe Billing Meter + plan prices (including Solo metered).
 *
 *   cd packages/db && pnpm exec tsx scripts/stripe-sync.ts
 *   cd packages/db && pnpm exec tsx scripts/stripe-sync.ts --with-overrides
 *
 * Needs DATABASE_URL and STRIPE_SECRET_KEY. Never run against live keys from tests.
 */
import { getEnv } from "@alinstra/config";
import { platformsFor } from "@alinstra/providers";
import { prisma } from "../src/client";
import { syncStripePrices } from "../src/stripe-sync";

async function main(): Promise<void> {
  const withOverrides = process.argv.includes("--with-overrides");
  const { billing } = platformsFor(getEnv());
  const result = await syncStripePrices(billing, { includeClientOverrides: withOverrides });
  console.log(
    `Synced meter ${result.meterId}; ${result.plans} plan(s); ${result.prices} price(s); tax_behavior patched ${result.taxBehaviorUpdated}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`stripe-sync failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
