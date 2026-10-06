import { ASSISTANT_NAME } from "@/lib/brand";
import { formatPlanCents, type PublicPlan } from "@alinstra/db";

export type PlanMarketing = {
  tagline: string;
  badge: string | null;
  recommended: boolean;
  ctaLabel: string;
  foundingWaiver: boolean;
  everythingIn: string | null;
  staticFeatures: string[];
};

const FALLBACK: PlanMarketing = {
  tagline: "",
  badge: null,
  recommended: false,
  ctaLabel: "Get started",
  foundingWaiver: false,
  everythingIn: null,
  staticFeatures: [],
};

export const PLAN_MARKETING: Record<string, PlanMarketing> = {
  solo: {
    tagline: "For owner-operators who want to sound like a real business.",
    badge: "Self-serve",
    recommended: false,
    ctaLabel: "Start Solo",
    foundingWaiver: false,
    everythingIn: null,
    staticFeatures: [
      "Answers 24/7 in two rings",
      "Messages and appointment requests by email",
      "Urgent transfers during business hours",
      "Set it up yourself with a guided 20-minute chat",
    ],
  },
  starter: {
    tagline: "For one location missing a handful of calls a week.",
    badge: null,
    recommended: false,
    ctaLabel: "Get started",
    foundingWaiver: true,
    everythingIn: "Solo",
    staticFeatures: ["Setup done with you by our team"],
  },
  professional: {
    tagline: "For busy offices and after-hours emergencies.",
    badge: null,
    recommended: true,
    ctaLabel: "Get started",
    foundingWaiver: true,
    everythingIn: "Starter",
    staticFeatures: ["Calendar booking once your calendar is connected"],
  },
  premium: {
    tagline: "For high call volume and frequent changes.",
    badge: null,
    recommended: false,
    ctaLabel: "Get started",
    foundingWaiver: true,
    everythingIn: "Professional",
    staticFeatures: [],
  },
};

export function planMarketingFor(code: string): PlanMarketing {
  return PLAN_MARKETING[code] ?? FALLBACK;
}

function roundTypical(value: number): number {
  const step = value < 200 ? 5 : 10;
  return Math.round(value / step) * step;
}

/** Typical call count band from included minutes (3–2 minutes per call). */
export function typicalCallsRange(minutes: number): { low: number; high: number } {
  return {
    low: roundTypical(minutes / 3),
    high: roundTypical(minutes / 2),
  };
}

export function planChangesLine(n: number | null): string {
  if (n == null) return `Unlimited updates to ${ASSISTANT_NAME}'s info`;
  if (n === 1) return `1 update to ${ASSISTANT_NAME}'s info each month`;
  return `${n} updates to ${ASSISTANT_NAME}'s info each month`;
}

export function planOverageLine(
  plan: Pick<PublicPlan, "overagePerMinuteCents" | "includedMinutes">,
  allPlans: Array<Pick<PublicPlan, "overagePerMinuteCents">>,
): string {
  const rate = `${formatPlanCents(plan.overagePerMinuteCents)} a minute after ${plan.includedMinutes.toLocaleString("en-US")}`;
  if (allPlans.length <= 1) return rate;
  const lowest = Math.min(...allPlans.map((row) => row.overagePerMinuteCents));
  const isStrictLowest =
    plan.overagePerMinuteCents === lowest &&
    allPlans.filter((row) => row.overagePerMinuteCents === lowest).length === 1;
  return isStrictLowest ? `Our lowest rate: ${rate}` : rate;
}

export function cheapestPlan(plans: PublicPlan[]): PublicPlan | null {
  if (plans.length === 0) return null;
  return plans.reduce((best, plan) => (plan.monthlyPriceCents < best.monthlyPriceCents ? plan : best));
}

export function foundingWaivedPlanNames(plans: PublicPlan[]): string[] {
  return plans.filter((plan) => planMarketingFor(plan.code).foundingWaiver).map((plan) => plan.name);
}

export function formatTypicalCallsLine(minutes: number): string {
  const { low, high } = typicalCallsRange(minutes);
  return `About ${low.toLocaleString("en-US")} to ${high.toLocaleString("en-US")} typical calls`;
}
