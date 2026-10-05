import { stripPhoneNumbers } from "../render";
import type { InterviewCollected } from "./types";

function mergeSection<T extends Record<string, unknown>>(base: T | undefined, patch: T | undefined): T | undefined {
  if (!patch) return base;
  if (!base) return { ...patch };
  return { ...base, ...patch };
}

/** Deep-merge interview updates. Staff / transfer free text is phone-stripped. */
export function mergeCollected(base: InterviewCollected, patch: InterviewCollected): InterviewCollected {
  const knowledge = mergeSection(base.knowledge, patch.knowledge);
  if (knowledge?.staff !== undefined) {
    knowledge.staff = stripPhoneNumbers(knowledge.staff) ?? undefined;
  }

  const features = mergeSection(base.features, patch.features);
  if (features?.transferTargetsText !== undefined) {
    // Labels/situations only — strip any numbers the model or owner typed in chat.
    features.transferTargetsText = stripPhoneNumbers(features.transferTargetsText) ?? undefined;
  }
  if (features?.messages !== undefined) {
    features.messages = stripPhoneNumbers(features.messages) ?? features.messages;
  }

  return {
    business: mergeSection(base.business, patch.business),
    knowledge,
    coverage: mergeSection(base.coverage, patch.coverage),
    features,
    voice: mergeSection(base.voice, patch.voice),
    compliance: mergeSection(base.compliance, patch.compliance),
  };
}

/** True when the draft field is empty so interview data may fill it. */
export function isEmptyField(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "boolean" || typeof value === "number") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Merge interview collected into an existing wizard payload.
 * Never overwrites a field that already has a value in `draft`.
 */
export function mergeIntoDraft<T extends Record<string, unknown>>(draft: T, collected: InterviewCollected): T {
  const out: Record<string, unknown> = { ...draft };

  for (const section of ["business", "knowledge", "coverage", "features", "voice", "compliance"] as const) {
    const patch = collected[section];
    if (!patch) continue;
    const current = (out[section] && typeof out[section] === "object" ? { ...(out[section] as object) } : {}) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (isEmptyField(current[key])) current[key] = value;
    }
    out[section] = current;
  }

  return out as T;
}

const TIME_HINT = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*-\s*\d{1,2})/i;

/**
 * Detect likely contradictions between front-office hours and after-hours / tech-line guidance.
 * Returns a clarifying question, or null when none.
 */
export function contradictionQuestion(collected: InterviewCollected): string | null {
  const hours = collected.knowledge?.hours?.trim() ?? "";
  const after = collected.coverage?.afterHours?.trim() ?? "";
  const emergency = collected.features?.emergencyHandling?.trim() ?? "";
  const tech = `${after}\n${emergency}`.trim();
  if (!hours || !tech) return null;

  const hoursTimes = hours.match(new RegExp(TIME_HINT.source, "gi")) ?? [];
  const techTimes = tech.match(new RegExp(TIME_HINT.source, "gi")) ?? [];
  if (hoursTimes.length === 0 || techTimes.length === 0) return null;

  // Same clock strings appearing in both with opposing "closed" / "on call" language.
  const hoursClosed = /closed|after hours|not open/i.test(hours);
  const techOpen = /on[- ]?call|emergency line|tech line|dispatch/i.test(tech);
  const shared = hoursTimes.some((t) => tech.toLowerCase().includes(t.toLowerCase()));
  if (shared && hoursClosed && techOpen) {
    return "I want to be sure I have this right: your front-office hours and the on-call / tech-line hours seem to overlap differently. Which schedule should Ava use when the office is closed?";
  }

  // Explicit conflicting "open until" style claims.
  const officeUntil = /until\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(hours);
  const techUntil = /until\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(tech);
  if (officeUntil?.[1] && techUntil?.[1] && officeUntil[1].replace(/\s/g, "").toLowerCase() !== techUntil[1].replace(/\s/g, "").toLowerCase()) {
    if (/tech|on[- ]?call|emergency/i.test(tech)) {
      return `Just to confirm: the office is open until ${officeUntil[1]}, but the tech/on-call line mentions ${techUntil[1]}. Which is correct for after-hours callers?`;
    }
  }

  return null;
}
