import {
  DEFAULT_TEXT_TOKEN_BUDGET,
  TEXT_BUDGET_EXCEEDED_MESSAGE,
  parseJsonObject,
  type TextPlatform,
} from "@alinstra/providers";
import { banksFor } from "./banks";
import { contradictionQuestion, mergeCollected } from "./merge";
import { INTERVIEW_SYSTEM_PROMPT, buildInterviewUserPayload } from "./prompt";
import type { InterviewIndustry, InterviewState, InterviewTurnResult, TokenUsage } from "./types";
import { parseModelTurn, validateInterviewUpdates } from "./validate";

const MAX_TOKENS = 800;

export type InterviewBudget = {
  inputTokens: number;
  outputTokens: number;
};

export function initialInterviewState(industry: InterviewIndustry): InterviewState {
  const items = banksFor(industry);
  return {
    industry,
    stage: "intro",
    collected: {},
    transcript: [],
    openQuestions: items.map((item) => item.id),
    skippedQuestions: [],
    answeredQuestions: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    done: false,
  };
}

function refreshOpenQuestions(state: InterviewState): string[] {
  const items = banksFor(state.industry);
  return items
    .filter((item) => {
      if (state.skippedQuestions.includes(item.id)) return false;
      if (state.answeredQuestions.includes(item.id)) return false;
      return !item.done(state.collected);
    })
    .map((item) => item.id);
}

function markAnswered(state: InterviewState, askedId: string | null): void {
  if (!askedId) return;
  const item = banksFor(state.industry).find((row) => row.id === askedId);
  if (!item) return;
  if (item.done(state.collected) && !state.answeredQuestions.includes(askedId)) {
    state.answeredQuestions = [...state.answeredQuestions, askedId];
  }
}

function requiredRemaining(state: InterviewState): string[] {
  return banksFor(state.industry)
    .filter((item) => item.required && !item.done(state.collected) && !state.skippedQuestions.includes(item.id))
    .map((item) => item.id);
}

function summaryReply(state: InterviewState): string {
  const bits: string[] = ["Thanks — I have enough to draft your receptionist setup."];
  if (state.collected.knowledge?.hours) bits.push("I captured your hours.");
  if (state.collected.knowledge?.services) bits.push("I noted your services.");
  if (state.collected.features?.bookingMode) bits.push(`Booking mode: ${state.collected.features.bookingMode.replace("_", " ")}.`);
  if (state.collected.voice?.assistantName) bits.push(`Receptionist name: ${state.collected.voice.assistantName}.`);
  bits.push("Review everything in the form next — you can edit any field before submit.");
  return bits.join(" ");
}

function budgetHit(usage: TokenUsage, budget: InterviewBudget): boolean {
  return usage.inputTokens >= budget.inputTokens || usage.outputTokens >= budget.outputTokens;
}

/**
 * One interview turn. Pure aside from the TextPlatform call — no database.
 */
export async function interviewTurn(input: {
  state: InterviewState;
  userMessage: string;
  text: TextPlatform;
  budget?: InterviewBudget;
}): Promise<InterviewTurnResult> {
  const budget = input.budget ?? { ...DEFAULT_TEXT_TOKEN_BUDGET };
  const state: InterviewState = {
    ...input.state,
    collected: { ...input.state.collected },
    transcript: [...input.state.transcript],
    openQuestions: [...input.state.openQuestions],
    skippedQuestions: [...input.state.skippedQuestions],
    answeredQuestions: [...input.state.answeredQuestions],
    tokenUsage: { ...input.state.tokenUsage },
  };

  const userMessage = input.userMessage.trim();
  if (!userMessage) {
    return { state, reply: "Say a little more whenever you are ready.", done: false };
  }

  if (state.done) {
    return { state, reply: "This interview is already finished. Open the wizard to review.", done: true };
  }

  if (budgetHit(state.tokenUsage, budget)) {
    state.done = true;
    return { state, reply: TEXT_BUDGET_EXCEEDED_MESSAGE, done: true, budgetExceeded: true };
  }

  state.transcript.push({ role: "user", content: userMessage });

  // Owner can skip optional items with a short cue.
  if (/^(skip|next|pass)\b/i.test(userMessage)) {
    const nextOptional = banksFor(state.industry).find(
      (item) => !item.required && state.openQuestions.includes(item.id),
    );
    if (nextOptional) {
      state.skippedQuestions = [...state.skippedQuestions, nextOptional.id];
      state.openQuestions = refreshOpenQuestions(state);
    }
  }

  const messages = state.transcript.map((turn) => ({ role: turn.role, content: turn.content }));
  // Keep the model prompt bounded: system + compact state payload as the latest user frame.
  const framed = [
    ...messages.slice(0, -1).slice(-12),
    { role: "user" as const, content: buildInterviewUserPayload(state, userMessage) },
  ];

  let completion;
  try {
    completion = await input.text.complete({
      system: INTERVIEW_SYSTEM_PROMPT,
      messages: framed,
      maxTokens: MAX_TOKENS,
      json: true,
    });
  } catch {
    const reply = "I had trouble reaching the interview assistant. Try that answer again in a moment.";
    state.transcript.push({ role: "assistant", content: reply });
    return { state, reply, done: false };
  }

  state.tokenUsage = {
    inputTokens: state.tokenUsage.inputTokens + completion.inputTokens,
    outputTokens: state.tokenUsage.outputTokens + completion.outputTokens,
  };

  if (budgetHit(state.tokenUsage, budget)) {
    const reply = TEXT_BUDGET_EXCEEDED_MESSAGE;
    state.transcript.push({ role: "assistant", content: reply });
    state.done = true;
    return { state, reply, done: true, budgetExceeded: true };
  }

  const json = parseJsonObject(completion.text);
  const parsed = parseModelTurn(json ?? {});
  if (!parsed.ok) {
    const reply = "I could not read that as a structured update. Please repeat the key detail in one short sentence.";
    state.transcript.push({ role: "assistant", content: reply });
    return { state, reply, done: false };
  }

  const updatesCheck = validateInterviewUpdates(parsed.value.updates);
  if (!updatesCheck.ok) {
    const reply = `I could not save that detail (${updatesCheck.error}). Could you rephrase it?`;
    state.transcript.push({ role: "assistant", content: reply });
    return { state, reply, done: false };
  }

  state.collected = mergeCollected(state.collected, updatesCheck.value);

  // Veterinary / healthcare signals.
  if (state.industry === "veterinary" || updatesCheck.value.compliance?.healthcareSensitive) {
    state.collected = mergeCollected(state.collected, {
      compliance: { healthcareSensitive: true, healthcareTouched: true },
    });
  }

  markAnswered(state, parsed.value.askedId);
  // Also mark any items now satisfied even if askedId was wrong/missing.
  for (const item of banksFor(state.industry)) {
    if (item.done(state.collected) && !state.answeredQuestions.includes(item.id) && !state.skippedQuestions.includes(item.id)) {
      state.answeredQuestions = [...state.answeredQuestions, item.id];
    }
  }

  const contradiction = contradictionQuestion(state.collected);
  state.openQuestions = refreshOpenQuestions(state);
  if (contradiction) {
    state.stage = "clarify";
    state.transcript.push({ role: "assistant", content: contradiction });
    return { state, reply: contradiction, done: false };
  }

  const remainingRequired = requiredRemaining(state);
  if (parsed.value.done || remainingRequired.length === 0) {
    if (remainingRequired.length === 0) {
      const reply = parsed.value.done ? parsed.value.reply : summaryReply(state);
      state.stage = "done";
      state.done = true;
      state.openQuestions = refreshOpenQuestions(state);
      state.transcript.push({ role: "assistant", content: reply });
      return { state, reply, done: true };
    }
  }

  state.stage = state.answeredQuestions.length === 0 ? "intro" : "collecting";
  const reply = parsed.value.reply;
  state.transcript.push({ role: "assistant", content: reply });
  return { state, reply, done: false };
}

/** Opening assistant message before the owner types. */
export function interviewGreeting(industry: InterviewIndustry): string {
  const focus =
    industry === "hvac"
      ? "We will cover hours, emergencies, service area, and who to reach after hours."
      : industry === "veterinary"
        ? "We will cover hours, species, emergencies, and what Ava must never say about medical care."
        : "We will cover hours, services, common questions, transfers, and the greeting.";
  return `Hi — I will ask a few short questions to set up your AI receptionist. ${focus} One question at a time; you can say "skip" on optional ones. What are your regular business hours?`;
}
