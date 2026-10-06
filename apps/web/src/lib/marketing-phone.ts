import { formatPhone } from "@alinstra/db";

const TOLL_FREE_NPA = new Set(["800", "833", "844", "855", "866", "877", "888"]);

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

/** True for NANP toll-free NPAs on +1 numbers. */
export function isTollFree(e164: string | null | undefined): boolean {
  if (!e164?.trim()) return false;
  const digits = e164.trim().replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return TOLL_FREE_NPA.has(digits.slice(1, 4));
  }
  if (digits.length === 10) return TOLL_FREE_NPA.has(digits.slice(0, 3));
  return false;
}
