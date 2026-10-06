import { PLAN_SEEDS } from "@alinstra/db";

const PLAN_CODES = new Set(PLAN_SEEDS.map((plan) => plan.code));

/** Active plan codes plus the Enterprise contact card. */
export function normalizePlanInterest(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toLowerCase();
  if (!code) return null;
  if (code === "enterprise" || PLAN_CODES.has(code as (typeof PLAN_SEEDS)[number]["code"])) return code;
  return null;
}

export function planInterestLabel(code: string): string {
  if (code === "enterprise") return "Enterprise";
  const seed = PLAN_SEEDS.find((plan) => plan.code === code);
  return seed?.name ?? code;
}
