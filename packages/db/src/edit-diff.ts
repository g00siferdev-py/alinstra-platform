import type { WizardPayload } from "./domain";

/** Which payload section each wizard step writes. Step 11 (Review) writes nothing. */
export const SECTION_BY_STEP: Record<number, keyof WizardPayload> = {
  1: "business",
  2: "websiteNotes",
  3: "plan",
  4: "coverage",
  5: "features",
  6: "voice",
  7: "knowledge",
  8: "phone",
  9: "compliance",
  10: "portalOwnerEmail",
};

const REDACTED_FIELD = /phone|email|number|target|recipient|staff/i;

export type FieldChange = { field: string; before?: string; after?: string; redacted?: true };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(empty)";
  const flat = typeof value === "string" ? value : JSON.stringify(value);
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

/** Field-level diff of one payload section. Values of contact-like fields are replaced with "(changed)". */
export function diffSection(section: string, before: unknown, after: unknown): FieldChange[] {
  if (typeof before !== "object" && typeof after !== "object") {
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
    return REDACTED_FIELD.test(section)
      ? [{ field: section, redacted: true }]
      : [{ field: section, before: describe(before), after: describe(after) }];
  }
  const left = record(before);
  const right = record(after);
  const changes: FieldChange[] = [];
  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (JSON.stringify(left[field] ?? null) === JSON.stringify(right[field] ?? null)) continue;
    changes.push(REDACTED_FIELD.test(field) ? { field, redacted: true } : { field, before: describe(left[field]), after: describe(right[field]) });
  }
  return changes;
}

/** Shape stored in ChangeLog.after for `admin_edit` entries. Redacted fields carry "(changed)" instead of values. */
export function changeLogFields(changes: FieldChange[]): Array<{ field: string; value?: string; before?: string; after?: string }> {
  return changes.map((change) => (change.redacted ? { field: change.field, value: "(changed)" } : change));
}
