import type { BankFieldPath } from "./banks/types";
import type { InterviewCollected } from "./types";

const SHORT_MAX = 500;
const LONG_MAX = 10_000;
const NAME_MAX = 40;

const LONG_FIELDS = new Set<BankFieldPath>([
  "knowledge.hours",
  "knowledge.services",
  "knowledge.faqs",
  "knowledge.policies",
  "knowledge.staff",
  "features.emergencyHandling",
]);

/** Max length for a collected string field (matches validate.ts). */
export function fieldMaxLength(path: BankFieldPath): number {
  if (path === "voice.assistantName") return NAME_MAX;
  if (LONG_FIELDS.has(path)) return LONG_MAX;
  return SHORT_MAX;
}

const STRING_FIELDS = new Set<BankFieldPath>([
  "business.name",
  "business.industry",
  "knowledge.hours",
  "knowledge.services",
  "knowledge.faqs",
  "knowledge.policies",
  "knowledge.staff",
  "coverage.lunchHours",
  "coverage.afterHours",
  "coverage.weekends",
  "coverage.holidays",
  "coverage.holdOverflow",
  "features.messages",
  "features.messageRecipients",
  "features.transferTargetsText",
  "features.emergencyHandling",
  "voice.greeting",
  "voice.assistantName",
  "voice.tone",
]);

/** First string field on the bank item — used for same-thing copy and raw fallback. */
export function primaryStringField(fields: BankFieldPath[]): BankFieldPath | null {
  return fields.find((field) => STRING_FIELDS.has(field)) ?? null;
}

function sectionAndKey(path: BankFieldPath): { section: keyof InterviewCollected; key: string } {
  const [section, key] = path.split(".", 2) as [keyof InterviewCollected, string];
  return { section, key };
}

export function getCollectedField(collected: InterviewCollected, path: BankFieldPath): unknown {
  const { section, key } = sectionAndKey(path);
  const row = collected[section];
  if (!row || typeof row !== "object") return undefined;
  return (row as Record<string, unknown>)[key];
}

export function setCollectedField(
  collected: InterviewCollected,
  path: BankFieldPath,
  value: unknown,
): InterviewCollected {
  const { section, key } = sectionAndKey(path);
  const prev = (collected[section] && typeof collected[section] === "object"
    ? { ...(collected[section] as object) }
    : {}) as Record<string, unknown>;
  prev[key] = value;
  return { ...collected, [section]: prev };
}

export function trimToFieldMax(value: string, path: BankFieldPath): string {
  const max = fieldMaxLength(path);
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** Short topic label for progress / summary lines. */
export function topicLabel(id: string, question: string): string {
  const known: Record<string, string> = {
    "gen.hours": "hours",
    "gen.services": "services",
    "gen.faqs": "common questions",
    "gen.pricing": "pricing",
    "gen.transfers": "transfers",
    "gen.nobody_picks_up": "missed calls",
    "gen.after_hours": "after-hours",
    "gen.emergencies": "emergencies",
    "gen.message_recipients": "message recipients",
    "gen.booking": "booking",
    "gen.greeting": "greeting",
    "gen.must_not": "do-not-say",
  };
  if (known[id]) return known[id]!;
  const short = question.split(/[?.!]/)[0] ?? question;
  return short.length > 28 ? `${short.slice(0, 26).trim()}…` : short.toLowerCase();
}
