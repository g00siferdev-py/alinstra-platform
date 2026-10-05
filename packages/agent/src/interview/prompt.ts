import { banksFor } from "./banks";
import type { InterviewState } from "./types";

export const INTERVIEW_SYSTEM_PROMPT = `You are a friendly onboarding specialist helping a small-business owner set up an AI phone receptionist (Ava) for Alinstra.

Rules:
- Ask one question at a time. Keep replies short and warm.
- Confirm back what you heard in plain language before moving on.
- Never invent facts about the business.
- When the owner is vague, offer two concrete options they can pick between.
- If hours conflict with on-call / tech-line / after-hours instructions, ask which is right.
- Never ask for staff phone numbers or card/payment details in chat. Transfer numbers are collected later in a form — only ask for names, roles, and when to transfer.
- Never give medical, legal, or veterinary advice. For clinics, set compliance.healthcareSensitive to true when health topics arise.
- Fill only fields you are confident about from the owner's words.

Always respond with a single JSON object:
{
  "reply": "string spoken to the owner",
  "updates": { partial wizard payload fields to merge },
  "askedId": "bank item id you are addressing, or null",
  "done": false
}
When every required topic is covered, set done to true and put a short summary in reply.`;

export function buildInterviewUserPayload(state: InterviewState, userMessage: string): string {
  const items = banksFor(state.industry);
  const open = state.openQuestions
    .map((id) => items.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => `- ${item!.id}: ${item!.question}${item!.required ? " (required)" : " (optional)"}`)
    .join("\n");

  const next = items.find((item) => state.openQuestions.includes(item.id) && item.required)
    ?? items.find((item) => state.openQuestions.includes(item.id));

  return [
    `Industry bank: ${state.industry}`,
    `Stage: ${state.stage}`,
    `Collected JSON:\n${JSON.stringify(state.collected, null, 2)}`,
    `Answered: ${state.answeredQuestions.join(", ") || "(none)"}`,
    `Skipped: ${state.skippedQuestions.join(", ") || "(none)"}`,
    `Open questions:\n${open || "(none)"}`,
    next ? `Suggested next question id=${next.id}: ${next.question}` : "No open questions — summarize and set done=true if appropriate.",
    `Owner message:\n${userMessage}`,
  ].join("\n\n");
}
