export const HOLD_REASON =
  "This looks like a price, discount, guarantee, or refund. An admin will review it before it goes live.";

const SENSITIVE =
  /\$\s?\d|\bfree\b|\bdiscount\b|\bguarantee\b|\brefund\b|%\s*off|\bpercent off\b|\bdollars\b|\bno charge\b|\bwaive(?:d|s)?\b|\bcomplimentary\b|\bhalf price\b/i;
const PHONE = /^\+?[\d\s().-]{7,20}$/;
const CLOCK = /\b(\d{1,2}):(\d{2})\b/g;

export type FaqItem = { question: string; answer: string };

export type QuickUpdateInput =
  | { kind: "hours"; text: string }
  | { kind: "closure"; text: string }
  | { kind: "staff"; text: string; transferNumber?: string }
  | { kind: "faq_add"; question: string; answer: string }
  | { kind: "faq_edit"; index: number; question: string; answer: string }
  | { kind: "faq_remove"; index: number };

export const CHANGE_CATEGORIES = ["services", "call_handling", "knowledge", "voice", "features", "other"] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export function sensitiveHoldReason(text: string): string | null {
  return SENSITIVE.test(text) ? HOLD_REASON : null;
}

function invalidClock(text: string): boolean {
  CLOCK.lastIndex = 0;
  for (const match of text.matchAll(CLOCK)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return true;
  }
  return false;
}

export function validPhone(value: string): boolean {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return PHONE.test(trimmed) && digits.length >= 7 && digits.length <= 15;
}

export function faqItems(value: unknown): FaqItem[] {
  if (Array.isArray(value)) {
    const items: FaqItem[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const row = item as { question?: unknown; answer?: unknown };
      items.push({
        question: typeof row.question === "string" ? row.question : "",
        answer: typeof row.answer === "string" ? row.answer : "",
      });
    }
    return items;
  }
  if (typeof value === "string" && value.trim()) {
    return [{ question: "Existing", answer: value }];
  }
  return [];
}

export function validateQuickUpdate(input: QuickUpdateInput): string | null {
  if (input.kind === "hours") {
    if (input.text.trim().length === 0) return "Enter the hours.";
    if (input.text.length > 10_000) return "Hours must be 10,000 characters or fewer.";
    if (invalidClock(input.text)) return "Use a real clock time, such as 9:00 or 17:30.";
    return null;
  }
  if (input.kind === "closure") {
    if (input.text.trim().length === 0) return "Enter the closure or notice.";
    if (input.text.length > 2_000) return "Notices must be 2,000 characters or fewer.";
    if (invalidClock(input.text)) return "Use a real clock time, such as 9:00 or 17:30.";
    return null;
  }
  if (input.kind === "staff") {
    if (input.text.trim().length === 0) return "Enter the staff directory.";
    if (input.text.length > 10_000) return "The staff directory must be 10,000 characters or fewer.";
    if (input.transferNumber && input.transferNumber.trim() && !validPhone(input.transferNumber)) {
      return "Enter a phone number with at least 7 digits.";
    }
    return null;
  }
  if (input.kind === "faq_remove") {
    if (!Number.isInteger(input.index) || input.index < 0) return "Choose a FAQ.";
    return null;
  }
  if (input.question.trim().length === 0 || input.answer.trim().length === 0) return "Enter a question and an answer.";
  if (input.question.length > 200) return "Questions must be 200 characters or fewer.";
  if (input.answer.length > 2_000) return "Answers must be 2,000 characters or fewer.";
  if (input.kind === "faq_edit" && (!Number.isInteger(input.index) || input.index < 0)) return "Choose a FAQ.";
  return null;
}

export function textsForHold(input: QuickUpdateInput): string {
  if (input.kind === "hours" || input.kind === "closure") return input.text;
  if (input.kind === "staff") return `${input.text}\n${input.transferNumber ?? ""}`;
  if (input.kind === "faq_remove") return "";
  return `${input.question}\n${input.answer}`;
}
