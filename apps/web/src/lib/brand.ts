/** Public product name. Replaces `[Product]` in marketing copy. Will change once. */
export const PRODUCT_NAME = "Ava";

/** Default persona name callers hear. Does not change with PRODUCT_NAME. */
export const ASSISTANT_NAME = "Ava";

export const MARKETING_EMAIL = "hello@alinstra.com";
export const MARKETING_LOCATION = "Morristown, Tennessee";
export const SITE_URL = "https://alinstra.com";

export type LaunchState = "prelaunch" | "live";

/**
 * Read at request time (not a build-time constant) so Railway can set
 * LAUNCH_STATE=live without a rebuild. Unset means prelaunch.
 */
export function launchState(): LaunchState {
  return process.env["LAUNCH_STATE"] === "live" ? "live" : "prelaunch";
}

export const COMPANY_TAGLINE = "Empowering businesses with the power of AI";

/** Plan cards. Prelaunch never links to checkout. Hero and nav "Get started" stay on /start. */
export function planCtaHref(code: string, state: LaunchState = launchState()): string {
  return state === "prelaunch" ? `/start?plan=${code}` : `/signup?plan=${code}`;
}

// Leaf export only — never import `@alinstra/db` here (client components use this file).
export { FOUNDING_OFFER, TERMS_VERSION } from "@alinstra/db/founding";
