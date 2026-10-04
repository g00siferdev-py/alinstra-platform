import { sensitiveHoldReason } from "@alinstra/agent";
import type { WizardPayload } from "./domain";

export const OWNER_STEP_HOLD_KIND = "owner_step";

export type OwnerStepHoldPayload = {
  kind: typeof OWNER_STEP_HOLD_KIND;
  step: number;
  title: string;
  payload: WizardPayload;
};

export const VOICE_HOLD_REASON = "Voice or greeting changes need a quick admin review before they go live.";
export const TRANSFER_HOLD_REASON = "Transfer target changes need a quick admin review before they go live.";
export const BOOKING_HOLD_REASON = "Booking mode changes need a quick admin review before they go live.";

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** Flatten the step's human-edited text for the sensitive-price/discount hold scan. */
export function ownerStepHoldTexts(step: number, payload: WizardPayload): string {
  if (step === 4) {
    const coverage = payload.coverage ?? {};
    return [coverage.afterHours, coverage.lunchHours, coverage.weekends, coverage.holidays, coverage.holdOverflow].map(asText).join("\n");
  }
  if (step === 5) {
    const features = payload.features ?? {};
    return [features.messages, features.emergencyHandling, features.transferTargetsText, features.weeklyHoursText, features.bookingMode].map(asText).join("\n");
  }
  if (step === 6) {
    const voice = payload.voice ?? {};
    return [voice.greeting, voice.tone, voice.assistantName, voice.languages].map(asText).join("\n");
  }
  if (step === 7) {
    const knowledge = payload.knowledge ?? {};
    return [knowledge.hours, knowledge.services, knowledge.faqs, knowledge.policies, knowledge.staff].map(asText).join("\n");
  }
  return "";
}

/**
 * Whether an owner step edit must wait for admin review. Always holds on voice change, transfer-target
 * change, or booking-mode change; also holds when the edited text trips `sensitiveHoldReason`.
 * Knowledge / coverage / features / greeting otherwise publish directly.
 */
export function ownerEditHoldReason(before: WizardPayload, after: WizardPayload, step: number): string | null {
  const sensitive = sensitiveHoldReason(ownerStepHoldTexts(step, after));
  if (sensitive) return sensitive;
  if (step === 6 && JSON.stringify(before.voice ?? null) !== JSON.stringify(after.voice ?? null)) return VOICE_HOLD_REASON;
  if (step === 5) {
    if ((before.features?.transferTargetsText ?? "") !== (after.features?.transferTargetsText ?? "")) return TRANSFER_HOLD_REASON;
    if ((before.features?.bookingMode ?? "") !== (after.features?.bookingMode ?? "")) return BOOKING_HOLD_REASON;
  }
  return null;
}

export function parseOwnerStepHold(payload: unknown): OwnerStepHoldPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.kind !== OWNER_STEP_HOLD_KIND) return null;
  if (typeof row.step !== "number" || typeof row.title !== "string" || !row.payload || typeof row.payload !== "object") return null;
  return { kind: OWNER_STEP_HOLD_KIND, step: row.step, title: row.title, payload: row.payload as WizardPayload };
}
