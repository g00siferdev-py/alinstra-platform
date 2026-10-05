import type { InterviewCollected } from "../types";

export type BankFieldPath =
  | "business.name"
  | "business.industry"
  | "knowledge.hours"
  | "knowledge.services"
  | "knowledge.faqs"
  | "knowledge.policies"
  | "knowledge.staff"
  | "coverage.lunchHours"
  | "coverage.afterHours"
  | "coverage.weekends"
  | "coverage.holidays"
  | "coverage.holdOverflow"
  | "features.messages"
  | "features.messageRecipients"
  | "features.transferTargetsText"
  | "features.bookingMode"
  | "features.emergencyHandling"
  | "features.liveTransfer"
  | "voice.greeting"
  | "voice.assistantName"
  | "voice.tone"
  | "compliance.healthcareSensitive";

export type BankItem = {
  id: string;
  /** Prompt hint shown to the model for this item. */
  question: string;
  required: boolean;
  fields: BankFieldPath[];
  /** True when enough data is present for this item. */
  done: (collected: InterviewCollected) => boolean;
  /**
   * Optional follow-up when the answer was too vague.
   * Return a question string, or null if no follow-up needed.
   */
  followUp?: (collected: InterviewCollected) => string | null;
};

export type QuestionBank = {
  industry: "general" | "hvac" | "veterinary";
  items: BankItem[];
};

export function textFilled(value: string | undefined | null, min = 3): boolean {
  return typeof value === "string" && value.trim().length >= min;
}
