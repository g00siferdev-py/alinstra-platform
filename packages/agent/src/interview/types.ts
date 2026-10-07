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
    /** Who to transfer to and when (names/roles only). Interview never writes transferTargetsText. */
    transferNotes?: string;
    bookingMode?: "request_only";
    liveTransfer?: boolean;
    emergencyHandling?: string;
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

export type AnswerStatus = "answered" | "skipped" | "unclear" | "off_topic";

export type InterviewTurnError =
  | "timeout"
  | "http_401"
  | "http_402"
  | "http_429"
  | "http_4xx"
  | "http_5xx"
  | "network"
  | "unknown";

/** Per-turn diagnostics persisted on the session for admin review. */
export type InterviewTurnLogEntry = {
  finishReason: string | null;
  parseOk: boolean;
  droppedPaths: string[];
  /** Reasons only — e.g. `weeklyHoursText: closing time before opening`. Never values. */
  droppedReasons?: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  currentQuestionId?: string | null;
  askCount?: number;
  answerStatus?: AnswerStatus | null;
  fallback?: "raw" | "same" | null;
  error?: InterviewTurnError | null;
  capabilityFlag?: boolean;
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
  /** Skipped required items that need a form answer before go-live. May include `hours_conflict`. */
  needsReviewQuestions: string[];
  /** Question ids auto-answered by the engine (e.g. booking defaults) — omitted from progressLine. */
  autoAnsweredQuestions?: string[];
  /** Contradiction texts already asked once; repeats become hours_conflict needs-review. */
  askedContradictions?: string[];
  /** Question the engine is currently asking. */
  currentQuestionId: string | null;
  /** How many times each bank item has been asked. Cap is 2. */
  askCounts: Record<string, number>;
  /** Client plan code at session start; null → most conservative wording. */
  planCode: string | null;
  /** Last successful client message id (idempotency). */
  lastClientMessageId?: string | null;
  /** Last assistant reply returned for that client message id. */
  lastAssistantReply?: string | null;
  tokenUsage: TokenUsage;
  done: boolean;
  /** Paths dropped from the last model updates object (forgiving parse). */
  lastDropped?: string[];
  /** One entry per model turn (excludes the greeting). */
  turnLog?: InterviewTurnLogEntry[];
};

export type ModelTurnJson = {
  confirmation: string;
  updates: InterviewCollected;
  answerStatus: AnswerStatus;
  followUp: string | null;
};

export type InterviewTurnResult = {
  state: InterviewState;
  reply: string;
  /** True when the interview finished or hit the token budget. */
  done: boolean;
  budgetExceeded?: boolean;
};
