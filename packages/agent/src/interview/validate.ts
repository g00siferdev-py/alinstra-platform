import { z } from "zod";
import type { AnswerStatus, InterviewCollected, ModelTurnJson } from "./types";

const optionalText = z.string().max(10_000).optional();
const shortText = z.string().max(500).optional();

const MULTILINE_STRING_FIELDS = new Set(["faqs", "policies", "staff"]);

const businessFields = z
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
  .partial();
const knowledgeFields = z
  .object({
    hours: optionalText,
    services: optionalText,
    faqs: optionalText,
    policies: optionalText,
    staff: optionalText,
  })
  .partial();
const coverageFields = z
  .object({
    lunchHours: shortText,
    afterHours: shortText,
    weekends: shortText,
    holidays: shortText,
    holdOverflow: shortText,
    unansweredAfterRings: z.number().int().min(1).max(20).optional(),
  })
  .partial();
const featuresFields = z
  .object({
    messages: shortText,
    messageRecipients: shortText,
    weeklyHoursText: optionalText,
    transferTargetsText: optionalText,
    bookingMode: z.enum(["request_only"]).optional(),
    liveTransfer: z.boolean().optional(),
    emergencyHandling: optionalText,
  })
  .partial();
const voiceFields = z
  .object({
    voiceId: z.enum(["voice_1", "voice_2", "voice_3", "voice_4"]).optional(),
    greeting: shortText,
    assistantName: z.string().max(40).optional(),
    disclosureMode: z.enum(["on_request", "upfront"]).optional(),
    tone: shortText,
    languages: shortText,
  })
  .partial();
const complianceFields = z
  .object({
    healthcareSensitive: z.boolean().optional(),
    healthcareTouched: z.boolean().optional(),
  })
  .partial();

/** Soft schemas aligned with packages/db/src/domain.ts — interview updates only. */
export const interviewCollectedSchema = z
  .object({
    business: businessFields.optional(),
    knowledge: knowledgeFields.optional(),
    coverage: coverageFields.optional(),
    features: featuresFields.optional(),
    voice: voiceFields.optional(),
    compliance: complianceFields.optional(),
  })
  .strict();

/** Hand-kept next to the schema so the model sees exact field names and types. */
export const INTERVIEW_UPDATES_SHAPE = `{
  "business": {
    "name": "string",
    "industry": "string",
    "contactName": "string",
    "contactEmail": "string (email)",
    "contactPhone": "string",
    "timezone": "string",
    "websiteUrl": "string (url)",
    "namePronunciation": "string",
    "publicPhone": "string",
    "publicEmail": "string (email)"
  },
  "knowledge": {
    "hours": "string",
    "services": "string (lists as one comma- or newline-separated string)",
    "faqs": "string (multi-line ok)",
    "policies": "string (multi-line ok)",
    "staff": "string (names/roles only; multi-line ok)"
  },
  "coverage": {
    "lunchHours": "string",
    "afterHours": "string",
    "weekends": "string",
    "holidays": "string",
    "holdOverflow": "string",
    "unansweredAfterRings": "number 1-20"
  },
  "features": {
    "messages": "string",
    "messageRecipients": "string",
    "weeklyHoursText": "string",
    "transferTargetsText": "string (labels/situations only, no phone numbers)",
    "bookingMode": "request_only",
    "liveTransfer": "boolean",
    "emergencyHandling": "string"
  },
  "voice": {
    "voiceId": "voice_1 | voice_2 | voice_3 | voice_4",
    "greeting": "string",
    "assistantName": "string",
    "disclosureMode": "on_request | upfront",
    "tone": "string",
    "languages": "string"
  },
  "compliance": {
    "healthcareSensitive": "boolean",
    "healthcareTouched": "boolean"
  }
}`;

const SECTION_SCHEMAS = {
  business: businessFields,
  knowledge: knowledgeFields,
  coverage: coverageFields,
  features: featuresFields,
  voice: voiceFields,
  compliance: complianceFields,
} as const;

type SectionName = keyof typeof SECTION_SCHEMAS;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function objectToReadableLines(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (entry === undefined || entry === null) return `${key}:`;
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        return `${key}: ${entry}`;
      }
      return `${key}: ${JSON.stringify(entry)}`;
    })
    .join("\n");
}

function coerceToString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        if (isPlainObject(item)) return objectToReadableLines(item);
        return "";
      })
      .filter(Boolean);
    if (parts.length === 0) return undefined;
    return parts.join(MULTILINE_STRING_FIELDS.has(field) ? "\n" : ", ");
  }
  if (isPlainObject(value)) return objectToReadableLines(value);
  return undefined;
}

function coerceToBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function coerceToNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceFieldValue(section: SectionName, field: string, value: unknown): unknown {
  if (field === "unansweredAfterRings") return coerceToNumber(value);
  if (field === "liveTransfer" || field === "healthcareSensitive" || field === "healthcareTouched") {
    return coerceToBoolean(value);
  }
  if (field === "bookingMode" || field === "voiceId" || field === "disclosureMode") {
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : undefined;
  }
  return coerceToString(value, field);
}

function expectedTypeForField(section: SectionName, field: string): string {
  if (field === "unansweredAfterRings") return "number";
  if (field === "liveTransfer" || field === "healthcareSensitive" || field === "healthcareTouched") return "boolean";
  if (field === "bookingMode") return "request_only";
  if (field === "voiceId" || field === "disclosureMode") return "string enum";
  return "string";
}

export type ForgivingUpdatesResult = {
  value: InterviewCollected;
  droppedPaths: string[];
  droppedReasons: string[];
};

/**
 * Coerce common model mistakes, then keep every field that validates independently.
 * Unknown keys and invalid values are dropped (never fail the whole turn).
 */
export function forgiveInterviewUpdates(raw: unknown): ForgivingUpdatesResult {
  const droppedPaths: string[] = [];
  const droppedReasons: string[] = [];
  const out: InterviewCollected = {};

  const drop = (path: string, reason: string) => {
    droppedPaths.push(path);
    droppedReasons.push(`${path}: ${reason}`);
  };

  if (raw === undefined || raw === null) return { value: out, droppedPaths, droppedReasons };
  if (!isPlainObject(raw)) {
    drop("updates", `expected object, got ${describeValueType(raw)}`);
    return { value: out, droppedPaths, droppedReasons };
  }

  for (const [sectionKey, sectionValue] of Object.entries(raw)) {
    if (!(sectionKey in SECTION_SCHEMAS)) {
      drop(sectionKey, "unknown section");
      continue;
    }
    const section = sectionKey as SectionName;
    if (sectionValue === undefined || sectionValue === null) continue;
    if (!isPlainObject(sectionValue)) {
      drop(section, `expected object, got ${describeValueType(sectionValue)}`);
      continue;
    }

    const kept: Record<string, unknown> = {};
    const fieldSchema = SECTION_SCHEMAS[section];
    const shape = fieldSchema.shape as Record<string, z.ZodTypeAny>;
    for (const [field, fieldValue] of Object.entries(sectionValue)) {
      const path = `${section}.${field}`;
      const zodField = shape[field];
      if (!zodField) {
        // Interview cannot set wizard-only fields (textConfirmations, textReminders, direct_calendar, …).
        drop(path, "unknown or disallowed field");
        continue;
      }
      if (fieldValue === undefined) continue;
      const coerced = coerceFieldValue(section, field, fieldValue);
      if (coerced === undefined) {
        drop(path, `expected ${expectedTypeForField(section, field)}, got ${describeValueType(fieldValue)}`);
        continue;
      }
      const single = zodField.safeParse(coerced);
      if (!single.success) {
        drop(path, `expected ${expectedTypeForField(section, field)}, got ${describeValueType(fieldValue)}`);
        continue;
      }
      kept[field] = single.data;
    }

    if (Object.keys(kept).length > 0) {
      (out as Record<string, unknown>)[section] = kept;
    }
  }

  return { value: out, droppedPaths, droppedReasons };
}

export type ValidateUpdatesResult =
  | { ok: true; value: InterviewCollected }
  | { ok: false; error: string };

export function validateInterviewUpdates(raw: unknown): ValidateUpdatesResult {
  const forgiven = forgiveInterviewUpdates(raw);
  // Strict path still available for callers that want all-or-nothing; prefer forgive in the engine.
  const parsed = interviewCollectedSchema.safeParse(forgiven.value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

const ANSWER_STATUSES = new Set<AnswerStatus>(["answered", "skipped", "unclear", "off_topic"]);

export type ForgivingTurnResult = {
  /** Non-empty confirmation when present. */
  confirmation: string | null;
  updates: InterviewCollected;
  answerStatus: AnswerStatus;
  followUp: string | null;
  droppedPaths: string[];
  droppedReasons: string[];
  /** True when a usable confirmation was recovered (updates may still be partial). */
  parseOk: boolean;
  error?: string;
};

function readAnswerStatus(raw: unknown): AnswerStatus {
  if (typeof raw === "string" && ANSWER_STATUSES.has(raw as AnswerStatus)) return raw as AnswerStatus;
  return "answered";
}

function readFollowUp(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1000);
}

/**
 * Parse envelope fields independently so a bad `updates` never discards `confirmation`.
 * Back-compat: if the model still sends `reply`, treat it as `confirmation`.
 */
export function parseModelTurnForgiving(raw: unknown): ForgivingTurnResult {
  if (!isPlainObject(raw)) {
    return {
      confirmation: null,
      updates: {},
      answerStatus: "unclear",
      followUp: null,
      droppedPaths: [],
      droppedReasons: [],
      parseOk: false,
      error: "Model output was not a JSON object",
    };
  }

  const confirmationRaw =
    typeof raw.confirmation === "string"
      ? raw.confirmation
      : typeof raw.reply === "string"
        ? raw.reply
        : null;
  const confirmation =
    typeof confirmationRaw === "string" && confirmationRaw.trim().length > 0
      ? confirmationRaw.trim().slice(0, 4000)
      : null;

  const answerStatus = readAnswerStatus(raw.answerStatus);
  const followUp = readFollowUp(raw.followUp);
  const forgiven = forgiveInterviewUpdates(raw.updates ?? {});

  if (!confirmation) {
    return {
      confirmation: null,
      updates: forgiven.value,
      answerStatus,
      followUp,
      droppedPaths: forgiven.droppedPaths,
      droppedReasons: forgiven.droppedReasons,
      parseOk: false,
      error:
        typeof confirmationRaw === "string"
          ? "confirmation was empty"
          : "confirmation missing or not a string",
    };
  }

  return {
    confirmation,
    updates: forgiven.value,
    answerStatus,
    followUp,
    droppedPaths: forgiven.droppedPaths,
    droppedReasons: forgiven.droppedReasons,
    parseOk: true,
  };
}

export type ParseTurnResult =
  | { ok: true; value: ModelTurnJson }
  | { ok: false; error: string };

/** Strict parse kept for tests/callers; engine uses parseModelTurnForgiving. */
export function parseModelTurn(raw: unknown): ParseTurnResult {
  const forgiven = parseModelTurnForgiving(raw);
  if (!forgiven.parseOk || !forgiven.confirmation) {
    return { ok: false, error: forgiven.error ?? "invalid turn" };
  }
  return {
    ok: true,
    value: {
      confirmation: forgiven.confirmation,
      updates: forgiven.updates,
      answerStatus: forgiven.answerStatus,
      followUp: forgiven.followUp,
    },
  };
}
