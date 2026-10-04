import { isIanaTimezone } from "./allowance";

const FALLBACK_TIMEZONE = "America/New_York";

/**
 * Formats a moment in the client's timezone as "Oct 4, 11:34 AM". Every page and email that shows a time
 * goes through this so admins and owners never see raw ISO or UTC strings.
 */
export function formatLocalTime(value: Date | string | number, timezone: string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timeZone = timezone && isIanaTimezone(timezone) ? timezone : FALLBACK_TIMEZONE;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

/** "+18883871525" becomes "+1 (888) 387-1525". Other shapes come back unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim());
  if (!match) return e164;
  return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
}
