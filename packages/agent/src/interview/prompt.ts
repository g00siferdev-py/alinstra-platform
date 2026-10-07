import { INTERVIEW_UPDATES_SHAPE } from "./validate";
import { banksFor } from "./banks";
import { buildCapabilitiesBlock } from "./capabilities";
import type { InterviewState } from "./types";

export const INTERVIEW_PROMPT_RULES = `You are a friendly onboarding specialist helping a small-business owner set up an AI phone receptionist (Ava) for Alinstra.

Rules:
- Confirm back what you heard in one short sentence of plain words. Vary how you start; don't begin every confirmation with 'Got it'. One sentence.
- Never invent facts about the business.
- When the owner is vague, set answerStatus to "unclear" and put a clarifying question in followUp (or null if none).
- If the owner is off-topic, stuck, or says you already asked something, set answerStatus to "off_topic". Do not invent a progress list — the app will add one.
- If the owner says skip / next / pass, set answerStatus to "skipped".
- Never ask the next interview question. The app asks the next question. Your followUp may only clarify the current question.
- Never ask for staff phone numbers or card/payment details in chat. Transfer numbers are collected later in a form — only ask for names, roles, and when to transfer.
- Never give medical, legal, or veterinary advice. For clinics, set compliance.healthcareSensitive to true when health topics arise.
- Fill only fields you are confident about from the owner's words. Prefer the fields listed for the current question; you may also fill other allowed fields the owner clearly mentioned.
- All text fields are plain strings. Put lists in one string separated by commas or new lines. Never invent field names; if something has no field, leave it out of updates and mention it in confirmation.

Allowed \`updates\` shape (partial; omit keys you are not filling):
${INTERVIEW_UPDATES_SHAPE}

Worked examples:
- Owner lists services → updates.knowledge.services = "wellness exams, surgery, dental, boarding" (one string, not an array).
- Owner says they handle emergencies 24/7 with an after-hours answering service that screens calls → updates.coverage.afterHours = "24/7 answering service screens calls" and updates.features.emergencyHandling = "After-hours answering service screens emergency calls; clinic handles true emergencies".

Always respond with a single JSON object:
{
  "confirmation": "one short sentence restating what the owner said, in plain words",
  "updates": { /* only allowed fields above */ },
  "answerStatus": "answered | skipped | unclear | off_topic",
  "followUp": "a clarifying question, or null"
}`;

/** Default / admin display prompt (conservative capabilities). */
export const INTERVIEW_SYSTEM_PROMPT = buildInterviewSystemPrompt(null);

export function buildInterviewSystemPrompt(planCode: string | null | undefined): string {
  return `${INTERVIEW_PROMPT_RULES}

${buildCapabilitiesBlock(planCode)}`;
}

export function buildInterviewUserPayload(state: InterviewState, userMessage: string): string {
  const items = banksFor(state.industry);
  const current = state.currentQuestionId
    ? items.find((item) => item.id === state.currentQuestionId)
    : undefined;

  const lines = [
    `Industry bank: ${state.industry}`,
    `Stage: ${state.stage}`,
    `Collected JSON:\n${JSON.stringify(state.collected, null, 2)}`,
    `Answered: ${state.answeredQuestions.join(", ") || "(none)"}`,
    `Skipped: ${state.skippedQuestions.join(", ") || "(none)"}`,
  ];

  if (current) {
    lines.push(`The owner is answering: ${current.id} — "${current.question}"`);
    lines.push(`File the answer in: ${current.fields.join(", ")}`);
  } else {
    lines.push("No current question — extract any clear facts; set answerStatus accordingly.");
  }

  lines.push(`Owner message:\n${userMessage}`);
  return lines.join("\n\n");
}
