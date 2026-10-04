import { isIanaTimezone } from "@alinstra/agent";
import { z } from "zod";

export const INDUSTRIES = [
  "hvac",
  "plumbing",
  "electrical",
  "veterinary",
  "pet_grooming",
  "dental",
  "medical_office",
  "salon_spa",
  "auto_repair",
  "pest_control",
  "home_services",
  "professional_services",
  "other",
] as const;

export const HEALTHCARE_INDUSTRIES = ["dental", "medical_office"] as const;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CLIENT_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_VERSION = 25;
export const MAX_EXTRACTED_CHARS = 200_000;
export const EXTRACT_TIMEOUT_MS = 60_000;
export const DEFAULT_TIMEZONE = "America/New_York";
export const EXTRA_CHANGE_FEE_CENTS = 4900;
export const REMOVABLE_CLIENT_STATUSES = ["lead", "demo"] as const;

export function clientCanBeRemoved(status: string): boolean {
  return (REMOVABLE_CLIENT_STATUSES as readonly string[]).includes(status);
}

export const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/csv": "csv",
} as const;

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalText = z.preprocess(emptyToUndefined, z.string().max(500).optional());
const longText = z.preprocess(emptyToUndefined, z.string().max(10_000).optional());

export const E164 = /^\+[1-9]\d{7,14}$/;
export const NANP_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
export const PUBLIC_PHONE_ERROR = "Enter the public phone as +1 followed by 10 digits, like +18883871525.";

/** Accepts "(888) 387-1525", "888-387-1525", "18883871525", or E.164 and returns E.164. */
export function normalizePublicPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const publicPhoneSchema = z.preprocess(
  (value) => {
    const text = emptyToUndefined(value);
    return typeof text === "string" ? normalizePublicPhone(text) : text;
  },
  z.string().regex(E164, PUBLIC_PHONE_ERROR).optional(),
);

export const businessSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry: z.enum(INDUSTRIES),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.string().trim().email(),
  contactPhone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  region: optionalText,
  postalCode: optionalText,
  country: optionalText,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default(DEFAULT_TIMEZONE)
    .refine(isIanaTimezone, "Enter an IANA timezone, such as America/New_York."),
  websiteUrl: z.preprocess(emptyToUndefined, z.string().url().max(500).optional()),
  namePronunciation: optionalText,
  publicPhone: publicPhoneSchema,
  publicEmail: z.preprocess(emptyToUndefined, z.string().trim().email("Enter the public email address.").max(200).optional()),
});

export const coverageSchema = z.object({
  unansweredAfterRings: z.preprocess(
    (value) => (value === "" || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(20).optional(),
  ),
  lunchHours: optionalText,
  afterHours: optionalText,
  weekends: optionalText,
  holidays: optionalText,
  holdOverflow: optionalText,
});

export const featuresSchema = z.object({
  messages: optionalText,
  messageRecipients: optionalText,
  weeklyHoursText: optionalText,
  transferTargetsText: optionalText,
  bookingMode: z.preprocess(emptyToUndefined, z.enum(["direct_calendar", "request_only"]).optional()),
  textConfirmations: z.boolean().optional(),
  textReminders: z.boolean().optional(),
  liveTransfer: z.boolean().optional(),
  emergencyHandling: optionalText,
  recallAddOn: z.boolean().optional(),
});

export const voiceSchema = z.object({
  voiceId: z.preprocess(emptyToUndefined, z.enum(["voice_1", "voice_2", "voice_3", "voice_4"]).optional()),
  greeting: optionalText,
  assistantName: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  disclosureMode: z.preprocess(emptyToUndefined, z.enum(["on_request", "upfront"]).optional()),
  tone: optionalText,
  languages: optionalText,
});

export const knowledgeFieldsSchema = z.object({
  hours: longText,
  services: longText,
  faqs: longText,
  policies: longText,
  staff: longText,
});

export const phoneSchema = z.object({
  mode: z.preprocess(emptyToUndefined, z.enum(["new_number", "forward"]).optional()),
  carrier: optionalText,
  currentNumber: optionalText,
  notes: optionalText,
  areaCode: z.preprocess(emptyToUndefined, z.string().regex(/^\d{3}$/, "Preferred area code must be 3 digits.").optional()),
  tollFree: z.preprocess((value) => value === true || value === "true", z.boolean()).optional(),
});

export const complianceSchema = z.object({
  aiDisclosure: z.literal(true).default(true),
  recordingNotice: z.boolean().default(true),
  healthcareSensitive: z.boolean().default(false),
  healthcareTouched: z.boolean().default(false),
  complianceReviewDone: z.boolean().default(false),
  complianceReviewNote: z.string().trim().max(500).default(""),
  recallConsent: z.boolean().default(false),
});

export const planSelectionSchema = z.object({
  planId: z.string().min(1),
  overrideMonthlyPriceCents: z.number().int().nonnegative().nullable().optional(),
  overrideIncludedMinutes: z.number().int().nonnegative().nullable().optional(),
  overrideOveragePerMinuteCents: z.number().int().nonnegative().nullable().optional(),
  overrideSetupFeeCents: z.number().int().nonnegative().nullable().optional(),
  overrideIncludedChangesPerMonth: z.number().int().nonnegative().nullable().optional(),
  setupFeeWaived: z.boolean().default(false),
});

export const wizardPayloadSchema = z.object({
  version: z.literal(1).default(1),
  business: businessSchema.partial().optional(),
  websiteNotes: z.string().max(5000).optional(),
  plan: planSelectionSchema.partial().optional(),
  coverage: coverageSchema.optional(),
  features: featuresSchema.optional(),
  voice: voiceSchema.optional(),
  knowledge: knowledgeFieldsSchema.optional(),
  phone: phoneSchema.optional(),
  compliance: complianceSchema.partial().optional(),
  portalOwnerEmail: z.string().trim().email().optional(),
});

export type WizardPayload = z.infer<typeof wizardPayloadSchema>;

/** Wizard step titles, indexed from step 1. Shared by the wizard UI, the edit flow, and the change log. */
export const WIZARD_STEP_TITLES = [
  "Business and contact",
  "Website notes",
  "Plan",
  "Coverage",
  "Features",
  "Voice and personality",
  "Knowledge base",
  "Phone setup",
  "Compliance",
  "Portal access",
  "Review and submit",
] as const;

/** Steps whose data reaches the receptionist. Plan, Portal access, and Review stay out. */
export const AGENT_AFFECTING_STEPS: ReadonlySet<number> = new Set([1, 4, 5, 6, 7, 8, 9]);

export function wizardStepTitle(step: number): string {
  return WIZARD_STEP_TITLES[step - 1] ?? `Step ${step}`;
}

export function emptyWizardPayload(): WizardPayload {
  return { version: 1, compliance: { aiDisclosure: true, recordingNotice: true } };
}

export const TRANSFER_NUMBER_ERROR = "Transfer numbers must be US or Canada numbers, like +14235550142.";

export function assertTransferNumber(e164: string): void {
  const area = e164.slice(2, 5);
  const exchange = e164.slice(5, 8);
  if (!NANP_E164.test(e164) || area === "900" || exchange === "900" || exchange === "976") {
    throw new Error(TRANSFER_NUMBER_ERROR);
  }
}

export function normalizeTransferNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `1${digits}` : digits;
  const e164 = `+${withCountry}`;
  try {
    assertTransferNumber(e164);
    return e164;
  } catch {
    return null;
  }
}

export function plainCallerName(value: string): string {
  let cleaned = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const control = code <= 31 || code === 127 || code === 0x2028 || code === 0x2029;
    cleaned += control ? " " : char;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 120) || "Caller";
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type WeeklyHours = Partial<Record<DayKey, { start: string; end: string }>>;

const DAY_LINE = /^(mon|tue|wed|thu|fri|sat|sun)\s+([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/i;

export function parseWeeklyHours(text: string): WeeklyHours {
  const hours: WeeklyHours = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = DAY_LINE.exec(line);
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
      throw new Error("Use one day per line, such as mon 09:00-17:00.");
    }
    const start = Number(match[2]) * 60 + Number(match[3]);
    const end = Number(match[4]) * 60 + Number(match[5]);
    if (end <= start) throw new Error("Closing time must be after opening time.");
    hours[match[1].toLowerCase() as DayKey] = { start: `${match[2]}:${match[3]}`, end: `${match[4]}:${match[5]}` };
  }
  return hours;
}

export function formatWeeklyHours(hours: WeeklyHours | null | undefined): string {
  if (!hours) return "";
  return DAY_KEYS.flatMap((day) => (hours[day] ? [`${day} ${hours[day].start}-${hours[day].end}`] : [])).join("\n");
}

export function parseTransferTargets(text: string): Array<{ label: string; e164: string }> {
  const rows: Array<{ label: string; e164: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const comma = line.lastIndexOf(",");
    const label = (comma === -1 ? "" : line.slice(0, comma)).trim();
    const e164 = (comma === -1 ? line : line.slice(comma + 1)).trim();
    if (!label) throw new Error(TRANSFER_NUMBER_ERROR);
    assertTransferNumber(e164);
    rows.push({ label, e164 });
  }
  return rows;
}

export function formatTransferTargets(rows: Array<{ label: string; e164: string }>): string {
  return rows.map((row) => `${row.label}, ${row.e164}`).join("\n");
}

export function parseRecipientEmails(text: string): string[] {
  const emails = text.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter message recipient emails separated by commas.");
  }
  return [...new Set(emails)];
}

export function officeOpen(hours: unknown, timezone: string, now: Date): boolean {
  if (!hours || typeof hours !== "object") return false;
  let weekday = "";
  let hour = "";
  let minute = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    weekday = parts.find((part) => part.type === "weekday")?.value.slice(0, 3).toLowerCase() ?? "";
    hour = parts.find((part) => part.type === "hour")?.value ?? "";
    minute = parts.find((part) => part.type === "minute")?.value ?? "";
  } catch {
    return false;
  }
  const window = (hours as WeeklyHours)[weekday as DayKey];
  if (!window) return false;
  const current = Number(hour) * 60 + Number(minute);
  const [startHour, startMinute] = window.start.split(":").map(Number);
  const [endHour, endMinute] = window.end.split(":").map(Number);
  if (startHour === undefined || startMinute === undefined || endHour === undefined || endMinute === undefined) return false;
  return current >= startHour * 60 + startMinute && current < endHour * 60 + endMinute;
}

export function maskCaller(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  const prefix = value.trim().startsWith("+") ? "+" : "";
  return `${prefix}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

const OFFICE_LINE =
  "Office open right now (computed by the system): {{office_open}}. If this says yes, treat the office as open. If no, closed. If unknown, use the current time and hours.";

export function retellPrompt(stored: string, timezone: string): string {
  const zone = /^[A-Za-z0-9_+\-/]+$/.test(timezone) ? timezone : DEFAULT_TIMEZONE;
  const rewritten = stored.replace(/\{\{current_time\}\}(?!_)/g, `{{current_time_${zone}}}`);
  if (rewritten.includes("{{office_open}}")) return rewritten;
  return `${rewritten}\n\n${OFFICE_LINE}`;
}

export function clientIsHealthcare(client: { industry: string | null; compliance: unknown }): boolean {
  const compliance = client.compliance && typeof client.compliance === "object" ? (client.compliance as { healthcareTouched?: boolean; healthcareSensitive?: boolean }) : {};
  if (compliance.healthcareTouched) return Boolean(compliance.healthcareSensitive);
  if (client.industry === "dental" || client.industry === "medical_office") return true;
  return Boolean(compliance.healthcareSensitive);
}

export function healthcareRequired(payload: WizardPayload): boolean {
  const industry = payload.business?.industry;
  const auto = industry === "dental" || industry === "medical_office";
  if (payload.compliance?.healthcareTouched) return Boolean(payload.compliance.healthcareSensitive);
  return auto || Boolean(payload.compliance?.healthcareSensitive);
}

export function assertDocumentType(filename: string, contentType: string): string {
  const allowed = ALLOWED_DOCUMENT_TYPES[contentType as keyof typeof ALLOWED_DOCUMENT_TYPES];
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (!allowed || allowed !== extension) {
    throw new Error("Upload a PDF, DOCX, TXT, or CSV file.");
  }
  return allowed;
}

export function sniffDocument(bytes: Buffer, extension: string): void {
  if (extension === "pdf" && !bytes.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw new Error("That file is not a PDF.");
  }
  if (extension === "docx" && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error("That file is not a DOCX document.");
  }
  if (extension === "txt" || extension === "csv") {
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    if (sample.includes(0)) throw new Error("That file is not plain text.");
  }
}
