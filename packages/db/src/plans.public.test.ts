import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import {
  formatIncludedChanges,
  formatOveragePerMinute,
  formatPlanCents,
  publicPlans,
  publicPlansFromSeeds,
  resetPublicPlansCache,
  seedPlans,
} from "./plans";
import { resetTestDatabase } from "./reset-test-database";

describe("publicPlans", () => {
  beforeEach(() => {
    resetPublicPlansCache();
    return resetTestDatabase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetPublicPlansCache();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns active plans ordered by sortOrder with marketing formatters", async () => {
    await seedPlans();
    await prisma.plan.create({
      data: {
        code: "legacy_hidden",
        name: "Legacy",
        monthlyPriceCents: 100,
        includedMinutes: 10,
        overagePerMinuteCents: 10,
        setupFeeCents: 100,
        includedChangesPerMonth: 0,
        extraChangeFeeCents: 4900,
        recallMonthlyCents: 0,
        recallPerBookingCents: 0,
        active: false,
        sortOrder: 0,
      },
    });
    const plans = await publicPlans();
    expect(plans.map((plan) => plan.code)).toEqual(["starter", "professional", "premium"]);
    expect(plans[0]).toMatchObject({
      name: "Starter",
      monthlyPriceCents: 19900,
      includedMinutes: 300,
      overagePerMinuteCents: 35,
      setupFeeCents: 29900,
      includedChangesPerMonth: 1,
    });
    expect(plans[2]?.includedChangesPerMonth).toBeNull();
    expect(formatPlanCents(19900)).toBe("$199");
    expect(formatPlanCents(35)).toBe("$0.35");
    expect(formatOveragePerMinute(35)).toBe("$0.35/min");
    expect(formatIncludedChanges(1)).toBe("1");
    expect(formatIncludedChanges(null)).toBe("Unlimited");
  });

  it("returns PLAN_SEEDS when Prisma throws", async () => {
    vi.spyOn(prisma.plan, "findMany").mockRejectedValueOnce(new Error("Can't reach database server at postgres"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const plans = await publicPlans();
    expect(plans).toEqual(publicPlansFromSeeds());
    expect(plans.map((plan) => plan.id)).toEqual(["starter", "professional", "premium"]);
    expect(plans.every((plan) => plan.recallMonthlyCents === 0 && plan.recallPerBookingCents === 0)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});
