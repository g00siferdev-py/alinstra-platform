/**
 * Phase B Part 3: create/refresh the alinstra_minutes Billing Meter and catalog prices
 * (base monthly, setup, graduated metered overage) for every active plan including Solo.
 *
 * Meter id is stored in AppSetting `stripe.meter.alinstra_minutes`.
 * Prices are idempotent by lookup key (keys include amounts).
 */
import {
  clientOverageLookupKey,
  METER_APP_SETTING_KEY,
  METER_EVENT_NAME,
  overageLookupKey,
  type BillingPlatform,
} from "@alinstra/providers";
import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";

export type SyncStripePricesReport = {
  meterId: string;
  plans: number;
  prices: number;
};

async function rememberPrice(lookupKey: string, stripePriceId: string, planCode: string, kind: string, amountCents: number) {
  const existing = await prisma.stripePrice.findUnique({ where: { lookupKey } });
  if (!existing) {
    await prisma.stripePrice.create({ data: { lookupKey, stripePriceId, planCode, kind, amountCents } });
    return;
  }
  if (existing.stripePriceId !== stripePriceId || existing.amountCents !== amountCents || existing.kind !== kind) {
    await prisma.stripePrice.update({
      where: { id: existing.id },
      data: { stripePriceId, amountCents, kind, planCode },
    });
  }
}

/** Persist meter id without ChangeLog noise (system bookkeeping, like backup.last). */
async function storeMeterSetting(meterId: string): Promise<void> {
  const value = JSON.parse(JSON.stringify({ meterId, eventName: METER_EVENT_NAME })) as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: METER_APP_SETTING_KEY },
    create: { key: METER_APP_SETTING_KEY, value, updatedBy: null },
    update: { value, updatedBy: null },
  });
}

export async function loadStoredMeterId(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: METER_APP_SETTING_KEY } });
  if (!row || typeof row.value !== "object" || row.value === null || Array.isArray(row.value)) return null;
  const meterId = (row.value as { meterId?: unknown }).meterId;
  return typeof meterId === "string" && meterId.length > 0 ? meterId : null;
}

/**
 * Ensure the Billing Meter exists, then create/refresh base, setup, and metered prices
 * for every active plan. Optionally sync per-client override prices when clients have
 * overrideIncludedMinutes / overrideOveragePerMinuteCents / overrideMonthlyPriceCents.
 */
export async function syncStripePrices(
  billing: BillingPlatform,
  options: { includeClientOverrides?: boolean } = {},
): Promise<SyncStripePricesReport> {
  const meter = await billing.ensureMeter({
    eventName: METER_EVENT_NAME,
    displayName: "Alinstra minutes",
    idempotencyKey: `meter_${METER_EVENT_NAME}`,
  });
  await storeMeterSetting(meter.meterId);

  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  let prices = 0;

  for (const plan of plans) {
    const monthlyKey = `plan_${plan.code}_monthly`;
    const monthly = await billing.ensurePrice({
      lookupKey: monthlyKey,
      amountCents: plan.monthlyPriceCents,
      kind: "recurring",
      productName: `${plan.name} monthly`,
      idempotencyKey: `price_${monthlyKey}_${plan.monthlyPriceCents}`,
    });
    await rememberPrice(monthlyKey, monthly.priceId, plan.code, "recurring", plan.monthlyPriceCents);
    prices += 1;

    if (plan.setupFeeCents > 0) {
      const setupKey = `plan_${plan.code}_setup`;
      const setup = await billing.ensurePrice({
        lookupKey: setupKey,
        amountCents: plan.setupFeeCents,
        kind: "setup",
        productName: `${plan.name} setup`,
        idempotencyKey: `price_${setupKey}_${plan.setupFeeCents}`,
      });
      await rememberPrice(setupKey, setup.priceId, plan.code, "setup", plan.setupFeeCents);
      prices += 1;
    }

    const meteredKey = overageLookupKey(plan.code, plan.includedMinutes, plan.overagePerMinuteCents);
    const metered = await billing.ensurePrice({
      lookupKey: meteredKey,
      amountCents: plan.overagePerMinuteCents,
      kind: "metered_overage",
      productName: `${plan.name} minutes`,
      idempotencyKey: `price_${meteredKey}`,
      meterId: meter.meterId,
      includedMinutes: plan.includedMinutes,
      overagePerMinuteCents: plan.overagePerMinuteCents,
    });
    await rememberPrice(meteredKey, metered.priceId, plan.code, "metered_overage", plan.overagePerMinuteCents);
    prices += 1;
  }

  if (options.includeClientOverrides) {
    const overridden = await prisma.client.findMany({
      where: {
        internal: false,
        planId: { not: null },
        OR: [
          { overrideMonthlyPriceCents: { not: null } },
          { overrideIncludedMinutes: { not: null } },
          { overrideOveragePerMinuteCents: { not: null } },
          { overrideSetupFeeCents: { not: null } },
        ],
      },
      include: { plan: true },
    });
    for (const client of overridden) {
      const plan = client.plan;
      if (!plan) continue;
      if (client.overrideMonthlyPriceCents != null) {
        const key = `client_${client.id}_monthly`;
        const amount = client.overrideMonthlyPriceCents;
        const price = await billing.ensurePrice({
          lookupKey: key,
          amountCents: amount,
          kind: "recurring",
          productName: `${plan.name} monthly (custom)`,
          idempotencyKey: `price_${key}_${amount}`,
        });
        await rememberPrice(key, price.priceId, plan.code, "recurring", amount);
        prices += 1;
      }
      if (client.overrideSetupFeeCents != null && client.overrideSetupFeeCents > 0 && !client.setupFeeWaived) {
        const key = `client_${client.id}_setup`;
        const amount = client.overrideSetupFeeCents;
        const price = await billing.ensurePrice({
          lookupKey: key,
          amountCents: amount,
          kind: "setup",
          productName: `${plan.name} setup (custom)`,
          idempotencyKey: `price_${key}_${amount}`,
        });
        await rememberPrice(key, price.priceId, plan.code, "setup", amount);
        prices += 1;
      }
      // Per-client metered price when either included minutes or overage rate is overridden.
      if (client.overrideIncludedMinutes != null || client.overrideOveragePerMinuteCents != null) {
        const included = client.overrideIncludedMinutes ?? plan.includedMinutes;
        const overage = client.overrideOveragePerMinuteCents ?? plan.overagePerMinuteCents;
        const key = clientOverageLookupKey(client.id, included, overage);
        const price = await billing.ensurePrice({
          lookupKey: key,
          amountCents: overage,
          kind: "metered_overage",
          productName: `${plan.name} minutes (custom)`,
          idempotencyKey: `price_${key}`,
          meterId: meter.meterId,
          includedMinutes: included,
          overagePerMinuteCents: overage,
        });
        await rememberPrice(key, price.priceId, plan.code, "metered_overage", overage);
        prices += 1;
      }
    }
  }

  return { meterId: meter.meterId, plans: plans.length, prices };
}
