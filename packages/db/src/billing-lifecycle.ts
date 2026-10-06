/**
 * Phase B Part 4: pause after 7 days past due, owner billing overview, plan-change requests.
 */
import { getEnv } from "@alinstra/config";
import { billingPausedOwnerEmail } from "@alinstra/email";
import {
  clientOverageLookupKey,
  overageLookupKey,
  type BillingPlatform,
} from "@alinstra/providers";
import type { Actor } from "./changes";
import { recordChange } from "./changes";
import { prisma } from "./client";
import { loadStoredMeterId } from "./stripe-sync";
import { assertTenantContext, type TenantContext } from "./tenant";

const PAUSE_ACTOR: Actor = { id: "billing-pause", role: "admin" };
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type OwnerEmail = { to: string; subject: string; text: string };

export type PausePastDueReport = {
  scanned: number;
  paused: number;
  ownerEmails: OwnerEmail[];
  adminNotices: Array<{ subject: string; text: string }>;
};

export type OwnerBillingOverview = {
  planName: string | null;
  planCode: string | null;
  monthlyPriceCents: number;
  overagePerMinuteCents: number;
  includedMinutes: number;
  minutesUsed: number;
  estimatedOverageCents: number;
  billingStatus: string;
  nextBillDate: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  pendingPlanName: string | null;
  pendingPlanChangeId: string | null;
  hasStripeCustomer: boolean;
};

function billingUrl(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/home/billing`;
}

async function ownerEmailForClient(clientId: string, portalOwnerEmail: string | null): Promise<string | null> {
  if (portalOwnerEmail?.trim()) return portalOwnerEmail.trim().toLowerCase();
  const owner = await prisma.user.findFirst({
    where: { clientId, role: "client_owner" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return owner?.email?.trim().toLowerCase() || null;
}

function effectiveMonthly(client: { overrideMonthlyPriceCents: number | null }, plan: { monthlyPriceCents: number }): number {
  return client.overrideMonthlyPriceCents ?? plan.monthlyPriceCents;
}

function effectiveIncluded(client: { overrideIncludedMinutes: number | null }, plan: { includedMinutes: number }): number {
  return client.overrideIncludedMinutes ?? plan.includedMinutes;
}

function effectiveOverage(
  client: { overrideOveragePerMinuteCents: number | null },
  plan: { overagePerMinuteCents: number },
): number {
  return client.overrideOveragePerMinuteCents ?? plan.overagePerMinuteCents;
}

/**
 * Daily job: pause non-internal clients past due more than 7 days.
 * Caller enqueues ownerEmails and adminNotices.
 */
export async function pausePastDueClients(now = new Date()): Promise<PausePastDueReport> {
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const candidates = await prisma.client.findMany({
    where: {
      archivedAt: null,
      internal: false,
      billingStatus: "past_due",
      pastDueSince: { lte: cutoff },
    },
    select: {
      id: true,
      name: true,
      portalOwnerEmail: true,
      pastDueSince: true,
    },
  });

  const report: PausePastDueReport = { scanned: candidates.length, paused: 0, ownerEmails: [], adminNotices: [] };

  for (const client of candidates) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.client.updateMany({
        where: { id: client.id, billingStatus: "past_due" },
        data: { billingStatus: "paused" },
      });
      if (updated.count === 0) return;
      await recordChange(tx, {
        clientId: client.id,
        actor: PAUSE_ACTOR,
        action: "billing.paused",
        entityType: "client",
        entityId: client.id,
        summary: `Paused ${client.name} after 7 days past due`,
        after: { billingStatus: "paused", pastDueSince: client.pastDueSince?.toISOString() ?? null },
      });
    });

    const still = await prisma.client.findUnique({ where: { id: client.id }, select: { billingStatus: true } });
    if (still?.billingStatus !== "paused") continue;
    report.paused += 1;

    const to = await ownerEmailForClient(client.id, client.portalOwnerEmail);
    if (to) {
      const mail = billingPausedOwnerEmail({ billingUrl: billingUrl() });
      report.ownerEmails.push({ to, ...mail });
    }
    report.adminNotices.push({
      subject: `Paused ${client.name} (past due > 7 days)`,
      text: `${client.name} was paused because payment has been past due for more than 7 days. Ava will not answer until the card is updated.`,
    });
  }

  return report;
}

export async function ownerBillingOverview(
  ctx: TenantContext,
  clientId: string,
): Promise<OwnerBillingOverview> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && ctx.clientId !== clientId) throw new Error("Wrong client.");
  if (ctx.role === "client_staff") throw new Error("Only the owner can view billing.");

  const client = await prisma.client.findFirstOrThrow({
    where: { id: clientId, archivedAt: null },
    include: {
      plan: true,
      pendingPlan: { select: { name: true } },
    },
  });

  const periodStart = client.stripeCurrentPeriodStart;
  const periodEnd = client.stripeCurrentPeriodEnd;
  const usageWhere =
    periodStart && periodEnd
      ? { clientId, startedAt: { gte: periodStart, lt: periodEnd } }
      : { clientId, startedAt: { gte: new Date(0) } };

  const minutesUsed = (
    await prisma.usageRecord.findMany({
      where: usageWhere,
      select: { billableMinutes: true },
    })
  ).reduce((sum, row) => sum + row.billableMinutes, 0);

  const includedMinutes = client.plan ? effectiveIncluded(client, client.plan) : 0;
  const overagePerMinuteCents = client.plan ? effectiveOverage(client, client.plan) : 0;
  const overageMinutes = Math.max(0, minutesUsed - includedMinutes);
  const pending = await prisma.planChangeRequest.findFirst({
    where: { clientId, status: { in: ["pending", "scheduled"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return {
    planName: client.plan?.name ?? null,
    planCode: client.plan?.code ?? null,
    monthlyPriceCents: client.plan ? effectiveMonthly(client, client.plan) : 0,
    overagePerMinuteCents,
    includedMinutes,
    minutesUsed,
    estimatedOverageCents: overageMinutes * overagePerMinuteCents,
    billingStatus: client.billingStatus,
    nextBillDate: periodEnd,
    periodStart,
    periodEnd,
    pendingPlanName: client.pendingPlan?.name ?? null,
    pendingPlanChangeId: pending?.id ?? null,
    hasStripeCustomer: Boolean(client.stripeCustomerId),
  };
}

export async function createOwnerPortalSession(
  ctx: Actor & { clientId: string },
  billing: BillingPlatform,
  returnUrl: string,
): Promise<{ url: string }> {
  assertTenantContext(ctx);
  if (ctx.role !== "client_owner") throw new Error("Only the owner can manage billing.");
  const client = await prisma.client.findFirstOrThrow({
    where: { id: ctx.clientId, archivedAt: null },
    select: { stripeCustomerId: true, internal: true },
  });
  if (client.internal) throw new Error("Internal clients are not billed.");
  if (!client.stripeCustomerId) throw new Error("No Stripe customer yet.");
  return billing.createPortalSession({ customerId: client.stripeCustomerId, returnUrl });
}

export async function requestPlanChange(
  ctx: Actor & { clientId: string },
  toPlanId: string,
): Promise<{ id: string; direction: "upgrade" | "downgrade" }> {
  assertTenantContext(ctx);
  if (ctx.role !== "client_owner") throw new Error("Only the owner can request a plan change.");

  const client = await prisma.client.findFirstOrThrow({
    where: { id: ctx.clientId, archivedAt: null },
    include: { plan: true },
  });
  if (!client.planId || !client.plan) throw new Error("Choose a plan before requesting a change.");
  if (client.planId === toPlanId) throw new Error("You are already on that plan.");
  if (client.internal) throw new Error("Internal clients are not billed.");

  const open = await prisma.planChangeRequest.findFirst({
    where: { clientId: client.id, status: { in: ["pending", "scheduled"] } },
  });
  if (open) throw new Error("A plan change is already waiting for review.");

  const toPlan = await prisma.plan.findFirst({ where: { id: toPlanId, active: true } });
  if (!toPlan) throw new Error("That plan is not available.");

  const fromCents = effectiveMonthly(client, client.plan);
  const toCents = toPlan.monthlyPriceCents;
  const direction: "upgrade" | "downgrade" = toCents >= fromCents ? "upgrade" : "downgrade";

  const row = await prisma.planChangeRequest.create({
    data: {
      clientId: client.id,
      fromPlanId: client.planId,
      toPlanId: toPlan.id,
      direction,
      status: "pending",
      createdById: ctx.id,
    },
  });
  await prisma.$transaction(async (tx) => {
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "billing.plan_change_requested",
      entityType: "plan_change_request",
      entityId: row.id,
      summary: `Requested ${direction} to ${toPlan.name}`,
      after: { direction, toPlanId: toPlan.id, fromPlanId: client.planId },
    });
  });
  return { id: row.id, direction };
}

export async function cancelPlanChangeRequest(ctx: Actor & { clientId: string }, id: string): Promise<void> {
  assertTenantContext(ctx);
  if (ctx.role !== "client_owner") throw new Error("Only the owner can cancel a plan change.");
  const row = await prisma.planChangeRequest.findFirst({ where: { id, clientId: ctx.clientId } });
  if (!row) throw new Error("Plan change not found.");
  if (row.status !== "pending") throw new Error("Only a pending request can be cancelled.");
  await prisma.planChangeRequest.update({ where: { id }, data: { status: "cancelled" } });
}

async function ensurePlanPrices(
  billing: BillingPlatform,
  client: {
    id: string;
    overrideMonthlyPriceCents: number | null;
    overrideIncludedMinutes: number | null;
    overrideOveragePerMinuteCents: number | null;
  },
  plan: {
    code: string;
    name: string;
    monthlyPriceCents: number;
    includedMinutes: number;
    overagePerMinuteCents: number;
  },
): Promise<{ recurringPriceId: string; meteredPriceId: string | null }> {
  const monthlyAmount = effectiveMonthly(client, plan);
  const monthlyKey =
    client.overrideMonthlyPriceCents != null ? `client_${client.id}_monthly` : `plan_${plan.code}_monthly`;
  const recurring = await billing.ensurePrice({
    lookupKey: monthlyKey,
    amountCents: monthlyAmount,
    kind: "recurring",
    productName: `${plan.name} monthly`,
    idempotencyKey: `price_${monthlyKey}_${monthlyAmount}`,
  });
  await prisma.stripePrice.upsert({
    where: { lookupKey: monthlyKey },
    create: {
      lookupKey: monthlyKey,
      stripePriceId: recurring.priceId,
      planCode: plan.code,
      kind: "recurring",
      amountCents: monthlyAmount,
    },
    update: { stripePriceId: recurring.priceId, amountCents: monthlyAmount, kind: "recurring", planCode: plan.code },
  });

  const included = effectiveIncluded(client, plan);
  const overage = effectiveOverage(client, plan);
  const meteredOverride = client.overrideIncludedMinutes != null || client.overrideOveragePerMinuteCents != null;
  const meteredLookup = meteredOverride
    ? clientOverageLookupKey(client.id, included, overage)
    : overageLookupKey(plan.code, included, overage);

  let meteredPriceId: string | null = null;
  const meterId = await loadStoredMeterId();
  if (meterId) {
    const metered = await billing.ensurePrice({
      lookupKey: meteredLookup,
      amountCents: overage,
      kind: "metered_overage",
      productName: meteredOverride ? `${plan.name} minutes (custom)` : `${plan.name} minutes`,
      idempotencyKey: `price_${meteredLookup}`,
      meterId,
      includedMinutes: included,
      overagePerMinuteCents: overage,
    });
    await prisma.stripePrice.upsert({
      where: { lookupKey: meteredLookup },
      create: {
        lookupKey: meteredLookup,
        stripePriceId: metered.priceId,
        planCode: plan.code,
        kind: "metered_overage",
        amountCents: overage,
      },
      update: { stripePriceId: metered.priceId, amountCents: overage, kind: "metered_overage", planCode: plan.code },
    });
    meteredPriceId = metered.priceId;
  } else {
    const row = await prisma.stripePrice.findUnique({ where: { lookupKey: meteredLookup } });
    meteredPriceId = row?.kind === "metered_overage" ? row.stripePriceId : null;
  }

  return { recurringPriceId: recurring.priceId, meteredPriceId };
}

/**
 * Admin approves a plan change. Upgrades swap immediately with proration; downgrades
 * swap Stripe prices without proration and keep planId until the next period.
 */
export async function approvePlanChangeRequest(
  ctx: Actor,
  id: string,
  billing: BillingPlatform,
  now = new Date(),
): Promise<{ status: "applied" | "scheduled" }> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can approve plan changes.");

  const row = await prisma.planChangeRequest.findFirstOrThrow({
    where: { id },
    include: {
      toPlan: true,
      fromPlan: true,
      client: true,
    },
  });
  if (row.status !== "pending") throw new Error("This request is not pending.");
  if (!row.client.stripeSubscriptionId) throw new Error("Client has no Stripe subscription.");

  const prices = await ensurePlanPrices(billing, row.client, row.toPlan);
  const upgrade = row.direction === "upgrade";

  await billing.updateSubscriptionPrices({
    subscriptionId: row.client.stripeSubscriptionId,
    recurringPriceId: prices.recurringPriceId,
    meteredPriceId: prices.meteredPriceId,
    prorationBehavior: upgrade ? "create_prorations" : "none",
  });

  if (upgrade) {
    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: row.clientId },
        data: { planId: row.toPlanId, pendingPlanId: null },
      });
      await tx.planChangeRequest.update({
        where: { id: row.id },
        data: { status: "applied", reviewedById: ctx.id, reviewedAt: now, appliedAt: now },
      });
      await recordChange(tx, {
        clientId: row.clientId,
        actor: ctx,
        action: "billing.plan_upgraded",
        entityType: "plan_change_request",
        entityId: row.id,
        summary: `Upgraded ${row.client.name} to ${row.toPlan.name}`,
        after: { planId: row.toPlanId },
      });
    });
    return { status: "applied" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: row.clientId },
      data: { pendingPlanId: row.toPlanId },
    });
    await tx.planChangeRequest.update({
      where: { id: row.id },
      data: { status: "scheduled", reviewedById: ctx.id, reviewedAt: now },
    });
    await recordChange(tx, {
      clientId: row.clientId,
      actor: ctx,
      action: "billing.plan_downgrade_scheduled",
      entityType: "plan_change_request",
      entityId: row.id,
      summary: `Scheduled downgrade of ${row.client.name} to ${row.toPlan.name} at next renewal`,
      after: { pendingPlanId: row.toPlanId },
    });
  });
  return { status: "scheduled" };
}

export async function rejectPlanChangeRequest(ctx: Actor, id: string, now = new Date()): Promise<void> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can reject plan changes.");
  const row = await prisma.planChangeRequest.findFirstOrThrow({ where: { id } });
  if (row.status !== "pending") throw new Error("This request is not pending.");
  await prisma.planChangeRequest.update({
    where: { id },
    data: { status: "rejected", reviewedById: ctx.id, reviewedAt: now },
  });
}

/** Apply a scheduled downgrade when the Stripe period advances. */
export async function applyScheduledPlanChanges(
  clientId: string,
  previousPeriodStart: Date | null,
  nextPeriodStart: Date | null,
  now = new Date(),
): Promise<void> {
  if (!nextPeriodStart) return;
  if (previousPeriodStart && nextPeriodStart.getTime() <= previousPeriodStart.getTime()) return;

  const client = await prisma.client.findFirst({
    where: { id: clientId, pendingPlanId: { not: null }, archivedAt: null },
    include: { pendingPlan: true },
  });
  if (!client?.pendingPlanId || !client.pendingPlan) return;

  const scheduled = await prisma.planChangeRequest.findFirst({
    where: { clientId, status: "scheduled", toPlanId: client.pendingPlanId },
    orderBy: { createdAt: "desc" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { planId: client.pendingPlanId, pendingPlanId: null },
    });
    if (scheduled) {
      await tx.planChangeRequest.update({
        where: { id: scheduled.id },
        data: { status: "applied", appliedAt: now },
      });
    }
    await recordChange(tx, {
      clientId,
      actor: PAUSE_ACTOR,
      action: "billing.plan_downgrade_applied",
      entityType: "client",
      entityId: clientId,
      summary: `Applied scheduled downgrade to ${client.pendingPlan!.name}`,
      after: { planId: client.pendingPlanId },
    });
  });
}

export async function listPlanChangeRequests(ctx: Actor, clientId?: string) {
  assertTenantContext(ctx);
  if (ctx.role === "admin") {
    return prisma.planChangeRequest.findMany({
      where: clientId ? { clientId } : { status: { in: ["pending", "scheduled"] } },
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        fromPlan: { select: { id: true, name: true, code: true } },
        toPlan: { select: { id: true, name: true, code: true, monthlyPriceCents: true } },
      },
      take: 50,
    });
  }
  if (ctx.role !== "client_owner" || !ctx.clientId) throw new Error("Not available.");
  return prisma.planChangeRequest.findMany({
    where: { clientId: ctx.clientId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      fromPlan: { select: { id: true, name: true, code: true } },
      toPlan: { select: { id: true, name: true, code: true, monthlyPriceCents: true } },
    },
    take: 20,
  });
}

export { ownerEmailForClient, billingUrl };
