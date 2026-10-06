/** When active, setup fees are waived on founding-waiver plans for the first N paying businesses. */
export const FOUNDING_OFFER = {
  active: true,
  audience: "our first ten businesses",
  maxPaidWaivers: 10,
} as const;

/** Plan codes that receive the founding setup-fee waiver (not Solo). */
export const FOUNDING_WAIVER_PLAN_CODES = ["starter", "professional", "premium"] as const;

export function planHasFoundingWaiver(code: string): boolean {
  return (FOUNDING_WAIVER_PLAN_CODES as readonly string[]).includes(code);
}

/** Legal terms version recorded on self-serve signup. Bump when /legal terms change. */
export const TERMS_VERSION = "2026-10-06";
