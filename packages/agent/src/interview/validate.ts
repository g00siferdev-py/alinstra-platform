import { z } from "zod";
import type { InterviewCollected, ModelTurnJson } from "./types";

const optionalText = z.string().max(10_000).optional();
const shortText = z.string().max(500).optional();

/** Soft schemas aligned with packages/db/src/domain.ts — interview updates only. */
const interviewCollectedSchema = z
  .object({
    business: z
      .object({
        name: shortText,
        industry: shortText,
        contactName: shortText,
        contactEmail: z.string().email().max(200).optional().or(z.literal("")),
        contactPhone: shortText,
        timezone: shortText,
        websiteUrl: z.string().url().max(500).optional().or(z.literal("")),
        namePronunciation: shortText,
        publicPhone: shortText,
        publicEmail: z.string().email().max(200).optional().or(z.literal("")),
      })
      .partial()
      .optional(),
    knowledge: z
      .object({
        hours: optionalText,
        services: optionalText,
        faqs: optionalText,
        policies: optionalText,
        staff: optionalText,
      })
      .partial()
      .optional(),
    coverage: z
      .object({
        lunchHours: shortText,
        afterHours: shortText,
        weekends: shortText,
        holidays: shortText,
        holdOverflow: shortText,
        unansweredAfterRings: z.number().int().min(1).max(20).optional(),
      })
      .partial()
      .optional(),
    features: z
      .object({
        messages: shortText,
        messageRecipients: shortText,
        weeklyHoursText: optionalText,
        transferTargetsText: optionalText,
        bookingMode: z.enum(["direct_calendar", "request_only"]).optional(),
        liveTransfer: z.boolean().optional(),
        emergencyHandling: optionalText,
        textConfirmations: z.boolean().optional(),
        textReminders: z.boolean().optional(),
      })
      .partial()
      .optional(),
    voice: z
      .object({
        voiceId: z.enum(["voice_1", "voice_2", "voice_3", "voice_4"]).optional(),
        greeting: shortText,
        assistantName: z.string().max(40).optional(),
        disclosureMode: z.enum(["on_request", "upfront"]).optional(),
        tone: shortText,
        languages: shortText,
      })
      .partial()
      .optional(),
    compliance: z
      .object({
        healthcareSensitive: z.boolean().optional(),
        healthcareTouched: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

const modelTurnSchema = z.object({
  reply: z.string().min(1).max(4000),
  updates: interviewCollectedSchema.default({}),
  askedId: z.string().max(80).nullable().default(null),
  done: z.boolean().default(false),
});

export type ValidateUpdatesResult =
  | { ok: true; value: InterviewCollected }
  | { ok: false; error: string };

export function validateInterviewUpdates(raw: unknown): ValidateUpdatesResult {
  const parsed = interviewCollectedSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

export type ParseTurnResult =
  | { ok: true; value: ModelTurnJson }
  | { ok: false; error: string };

export function parseModelTurn(raw: unknown): ParseTurnResult {
  const parsed = modelTurnSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return {
    ok: true,
    value: {
      reply: parsed.data.reply,
      updates: parsed.data.updates,
      askedId: parsed.data.askedId,
      done: parsed.data.done,
    },
  };
}
