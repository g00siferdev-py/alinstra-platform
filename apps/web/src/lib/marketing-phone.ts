import { formatPhone } from "@alinstra/db";

/** Display shape for marketing CTAs: "(888) 387-1525" from +18883871525. */
export function marketingPhoneDisplay(e164: string | null | undefined): string {
  if (!e164?.trim()) return "";
  const formatted = formatPhone(e164.trim());
  return formatted.replace(/^\+1\s*/, "");
}

export function marketingTelHref(e164: string | null | undefined): string | null {
  if (!e164?.trim()) return null;
  const digits = e164.trim().replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}
