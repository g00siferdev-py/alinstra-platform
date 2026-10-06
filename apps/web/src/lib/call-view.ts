/** Pure display helpers for the calls screens. No database access; tested directly. */

export const OUTCOME_OPTIONS = [
  ["message_taken", "Message taken"],
  ["transferred", "Transferred"],
  ["booked", "Booked"],
  ["no_action", "No action"],
  ["hung_up", "Hung up"],
] as const;

export type OutcomeKey = (typeof OUTCOME_OPTIONS)[number][0];

export function outcomeLabel(outcome: string | null | undefined, endReason?: string | null): string {
  if (!outcome) {
    if (endReason === "no_final_report") return "Ended (no final report)";
    return "In progress";
  }
  return OUTCOME_OPTIONS.find(([key]) => key === outcome)?.[1] ?? outcome;
}

/** Sentiment is always a label plus a glyph, never color alone. */
export function sentimentDisplay(sentiment: string | null | undefined): { label: string; icon: string } {
  switch (sentiment) {
    case "Positive":
      return { label: "Positive", icon: "+" };
    case "Negative":
      return { label: "Negative", icon: "−" };
    case "Neutral":
      return { label: "Neutral", icon: "=" };
    default:
      return { label: "Unknown", icon: "?" };
  }
}

/** 61 → "1:01", 3725 → "1:02:05", null → "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

/** Transcript offsets: 65.4 → "1:05". */
export function formatOffset(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  return formatDuration(Math.floor(seconds));
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export type CallFilters = { from: Date | null; to: Date | null; outcome: OutcomeKey | null; cursor: string | null; fromText: string; toText: string };

function dateFromInput(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Reads list filters from the query string. Dates are whole days (UTC boundaries, a day either side of
 * local time is good enough for a filter); unknown outcomes are ignored.
 */
export function parseCallFilters(params: Record<string, string | string[] | undefined>): CallFilters {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const fromText = one("from") ?? "";
  const toText = one("to") ?? "";
  const outcome = one("outcome");
  return {
    from: dateFromInput(fromText, false),
    to: dateFromInput(toText, true),
    outcome: OUTCOME_OPTIONS.some(([key]) => key === outcome) ? (outcome as OutcomeKey) : null,
    cursor: one("cursor") || null,
    fromText: dateFromInput(fromText, false) ? fromText : "",
    toText: dateFromInput(toText, true) ? toText : "",
  };
}

export function filterQuery(filters: Pick<CallFilters, "fromText" | "toText" | "outcome">, cursor?: string | null): string {
  const query = new URLSearchParams();
  if (filters.fromText) query.set("from", filters.fromText);
  if (filters.toText) query.set("to", filters.toText);
  if (filters.outcome) query.set("outcome", filters.outcome);
  if (cursor) query.set("cursor", cursor);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function purgedNotice(formattedPurgedAt: string, retentionDays: number): string {
  return `Transcript and recording purged on ${formattedPurgedAt} per your ${retentionDays}-day retention.`;
}
