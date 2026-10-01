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
  timezone: z.string().trim().min(1).max(100).default(DEFAULT_TIMEZONE),
  websiteUrl: z.preprocess(emptyToUndefined, z.string().url().max(500).optional()),
});

export const coverageSchema = z.object({
  unansweredAfterRings: z.coerce.number().int().min(1).max(20).optional(),
  lunchHours: optionalText,
  afterHours: optionalText,
  weekends: optionalText,
  holidays: optionalText,
  holdOverflow: optionalText,
});

export const featuresSchema = z.object({
  messages: optionalText,
  bookingMode: z.enum(["direct_calendar", "request_only"]).optional(),
  textConfirmations: z.boolean().optional(),
  textReminders: z.boolean().optional(),
  liveTransfer: z.boolean().optional(),
  emergencyHandling: optionalText,
  recallAddOn: z.boolean().optional(),
});

export const voiceSchema = z.object({
  voiceId: z.enum(["voice_1", "voice_2", "voice_3", "voice_4"]).optional(),
  greeting: optionalText,
  tone: optionalText,
  languages: optionalText,
});

export const knowledgeFieldsSchema = z.object({
  hours: optionalText,
  services: optionalText,
  faqs: optionalText,
  policies: optionalText,
  staff: optionalText,
});

export const phoneSchema = z.object({
  mode: z.enum(["new_number", "forward"]).optional(),
  carrier: optionalText,
  currentNumber: optionalText,
  notes: optionalText,
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

export function emptyWizardPayload(): WizardPayload {
  return { version: 1, compliance: { aiDisclosure: true, recordingNotice: true } };
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
