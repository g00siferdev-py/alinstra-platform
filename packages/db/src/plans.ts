import { prisma } from "./client";
import { recordChange, type Actor } from "./changes";
import { EXTRA_CHANGE_FEE_CENTS } from "./domain";
import { assertTenantContext, type TenantContext } from "./tenant";

export const PLAN_SEEDS = [
  {
    code: "starter",
    name: "Starter",
    monthlyPriceCents: 19900,
    includedMinutes: 300,
    overagePerMinuteCents: 35,
    setupFeeCents: 29900,
    includedChangesPerMonth: 1,
    sortOrder: 1,
  },
  {
    code: "professional",
    name: "Professional",
    monthlyPriceCents: 39900,
    includedMinutes: 1000,
    overagePerMinuteCents: 30,
    setupFeeCents: 49900,
    includedChangesPerMonth: 2,
    sortOrder: 2,
  },
  {
    code: "premium",
    name: "Premium",
    monthlyPriceCents: 69900,
    includedMinutes: 2500,
    overagePerMinuteCents: 25,
    setupFeeCents: 79900,
    includedChangesPerMonth: null,
    sortOrder: 3,
  },
] as const;

export async function seedPlans(): Promise<void> {
  for (const plan of PLAN_SEEDS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: {
        ...plan,
        extraChangeFeeCents: EXTRA_CHANGE_FEE_CENTS,
        recallMonthlyCents: 2500,
        recallPerBookingCents: 600,
      },
      update: {},
    });
  }
}

const planSelect = {
  id: true,
  code: true,
  name: true,
  monthlyPriceCents: true,
  includedMinutes: true,
  overagePerMinuteCents: true,
  setupFeeCents: true,
  includedChangesPerMonth: true,
  extraChangeFeeCents: true,
  recallMonthlyCents: true,
  recallPerBookingCents: true,
  active: true,
  sortOrder: true,
} as const;

export type PublicPlan = {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number;
  includedMinutes: number;
  overagePerMinuteCents: number;
  setupFeeCents: number;
  includedChangesPerMonth: number | null;
  recallMonthlyCents: number;
  recallPerBookingCents: number;
  sortOrder: number;
};

const CACHE_MS = 60 * 60 * 1000;
let cachedPlans: { at: number; value: PublicPlan[] } | null = null;
let warnedPlansDbFailure = false;

/** Test helper — clears the in-process publicPlans cache. */
export function resetPublicPlansCache(): void {
  cachedPlans = null;
  warnedPlansDbFailure = false;
}

/** Seed catalog shaped as PublicPlan[] for marketing when the DB is unreachable. */
export function publicPlansFromSeeds(): PublicPlan[] {
  return PLAN_SEEDS.map((plan) => ({
    id: plan.code,
    code: plan.code,
    name: plan.name,
    monthlyPriceCents: plan.monthlyPriceCents,
    includedMinutes: plan.includedMinutes,
    overagePerMinuteCents: plan.overagePerMinuteCents,
    setupFeeCents: plan.setupFeeCents,
    includedChangesPerMonth: plan.includedChangesPerMonth,
    recallMonthlyCents: 0,
    recallPerBookingCents: 0,
    sortOrder: plan.sortOrder,
  }));
}

/**
 * Tenant-free active plans for the marketing pricing table, ordered by sortOrder.
 * Cached in-process for one hour. On database failure, returns PLAN_SEEDS (ids = codes).
 */
export async function publicPlans(): Promise<PublicPlan[]> {
  const now = Date.now();
  if (cachedPlans && now - cachedPlans.at < CACHE_MS) return cachedPlans.value;

  try {
    const value = await prisma.plan.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        monthlyPriceCents: true,
        includedMinutes: true,
        overagePerMinuteCents: true,
        setupFeeCents: true,
        includedChangesPerMonth: true,
        recallMonthlyCents: true,
        recallPerBookingCents: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    cachedPlans = { at: now, value };
    return value;
  } catch (error) {
    if (!warnedPlansDbFailure) {
      warnedPlansDbFailure = true;
      console.warn("[publicPlans] database unavailable; using PLAN_SEEDS fallback", error);
    }
    const value = publicPlansFromSeeds();
    cachedPlans = { at: now, value };
    return value;
  }
}

/** "$199" from 19900; whole dollars drop the cents. */
export function formatPlanCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars}`;
  return `$${dollars.toFixed(2)}`;
}

export function formatOveragePerMinute(cents: number): string {
  return `${formatPlanCents(cents)}/min`;
}

export function formatIncludedChanges(value: number | null): string {
  return value === null ? "Unlimited" : String(value);
}

export function plans(ctx: TenantContext) {
  assertTenantContext(ctx);
  return {
    list() {
      return prisma.plan.findMany({ where: { active: true }, select: planSelect, orderBy: { sortOrder: "asc" } });
    },
    getById(id: string) {
      return prisma.plan.findFirst({ where: { id, active: true }, select: planSelect });
    },
  };
}

export async function updatePlan(
  ctx: Actor,
  planId: string,
  patch: {
    monthlyPriceCents: number;
    includedMinutes: number;
    overagePerMinuteCents: number;
    setupFeeCents: number;
    includedChangesPerMonth: number | null;
    extraChangeFeeCents: number;
  },
) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can edit plans");
  return prisma.$transaction(async (tx) => {
    const before = await tx.plan.findUnique({ where: { id: planId }, select: planSelect });
    if (!before) throw new Error("Plan not found");
    const after = await tx.plan.update({ where: { id: planId }, data: patch, select: planSelect });
    await recordChange(tx, {
      clientId: null,
      actor: ctx,
      action: "plan.updated",
      entityType: "plan",
      entityId: planId,
      summary: `Updated ${after.name} pricing`,
      before,
      after,
    });
    return after;
  });
}
