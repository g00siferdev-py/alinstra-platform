/**
 * Partial wizard payload collected during the interview.
 * Shape matches `@alinstra/db` WizardPayload sections the interview fills.
 * Full domain zod validation runs here (soft) and again on draft merge.
 */
export type InterviewCollected = {
  business?: {
    name?: string;
    industry?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    timezone?: string;
    websiteUrl?: string;
    namePronunciation?: string;
    publicPhone?: string;
    publicEmail?: string;
  };
  knowledge?: {
    hours?: string;
    services?: string;
    faqs?: string;
    policies?: string;
    staff?: string;
  };
  coverage?: {
    lunchHours?: string;
    afterHours?: string;
    weekends?: string;
    holidays?: string;
    holdOverflow?: string;
    unansweredAfterRings?: number;
  };
  features?: {
    messages?: string;
    messageRecipients?: string;
    weeklyHoursText?: string;
    transferTargetsText?: string;
    bookingMode?: "direct_calendar" | "request_only";
    liveTransfer?: boolean;
    emergencyHandling?: string;
    textConfirmations?: boolean;
    textReminders?: boolean;
  };
  voice?: {
    voiceId?: "voice_1" | "voice_2" | "voice_3" | "voice_4";
    greeting?: string;
    assistantName?: string;
    disclosureMode?: "on_request" | "upfront";
    tone?: string;
    languages?: string;
  };
  compliance?: {
    healthcareSensitive?: boolean;
    healthcareTouched?: boolean;
  };
};

export type InterviewIndustry = "general" | "hvac" | "veterinary";

export type TranscriptTurn = {
  role: "user" | "assistant";
  content: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** Per-turn diagnostics persisted on the session for admin review. */
export type InterviewTurnLogEntry = {
  finishReason: string | null;
  parseOk: boolean;
  droppedPaths: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export type InterviewState = {
  industry: InterviewIndustry;
  stage: string;
  collected: InterviewCollected;
  transcript: TranscriptTurn[];
  /** Bank item ids still open (required unmet, or optional not skipped). */
  openQuestions: string[];
  /** Bank item ids the owner skipped. */
  skippedQuestions: string[];
  /** Bank item ids marked satisfied. */
  answeredQuestions: string[];
  tokenUsage: TokenUsage;
  done: boolean;
  /** Paths dropped from the last model updates object (forgiving parse). */
  lastDropped?: string[];
  /** One entry per model turn (excludes the greeting). */
  turnLog?: InterviewTurnLogEntry[];
};

export type ModelTurnJson = {
  reply: string;
  updates: InterviewCollected;
  askedId: string | null;
  done: boolean;
};

export type InterviewTurnResult = {
  state: InterviewState;
  reply: string;
  /** True when the interview finished or hit the token budget. */
  done: boolean;
  budgetExceeded?: boolean;
};
