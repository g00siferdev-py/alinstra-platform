import {
  DEFAULT_TEXT_TOKEN_BUDGET,
  TEXT_BUDGET_EXCEEDED_MESSAGE,
  parseJsonObject,
  type TextCompleteResult,
  type TextPlatform,
} from "@alinstra/providers";
import { banksFor } from "./banks";
import { contradictionQuestion, mergeCollected } from "./merge";
import { INTERVIEW_SYSTEM_PROMPT, buildInterviewUserPayload } from "./prompt";
import type {
  InterviewIndustry,
  InterviewState,
  InterviewTurnLogEntry,
  InterviewTurnResult,
  TokenUsage,
} from "./types";
import { parseModelTurnForgiving, type ForgivingTurnResult } from "./validate";

const MAX_TOKENS = 2000;
const HUMAN_FALLBACK = "Sorry, I lost my place for a second. Could you say that again?";

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
    lastDropped: [],
    turnLog: [],
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

function updatesWereAttempted(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const updates = (raw as { updates?: unknown }).updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) return false;
  return Object.keys(updates as object).length > 0;
}

function keptUpdateCount(updates: ForgivingTurnResult["updates"]): number {
  return Object.values(updates).reduce((n, section) => {
    if (!section || typeof section !== "object") return n;
    return n + Object.keys(section).length;
  }, 0);
}

function maybeSoftFollowUp(reply: string, parsed: ForgivingTurnResult, rawJson: unknown): string {
  if (parsed.droppedPaths.length === 0) return reply;
  if (keptUpdateCount(parsed.updates) > 0) return reply;
  if (!updatesWereAttempted(rawJson)) return reply;
  if (/rephrase|say that|one short|could you/i.test(reply)) return reply;
  return `${reply} Could you put that last detail in one short phrase?`;
}

function pushTurnLog(
  state: InterviewState,
  entry: InterviewTurnLogEntry,
): void {
  state.turnLog = [...(state.turnLog ?? []), entry];
}

function addUsage(state: InterviewState, completion: TextCompleteResult): void {
  state.tokenUsage = {
    inputTokens: state.tokenUsage.inputTokens + completion.inputTokens,
    outputTokens: state.tokenUsage.outputTokens + completion.outputTokens,
  };
}

async function completeOnce(
  text: TextPlatform,
  framed: { role: "user" | "assistant"; content: string }[],
): Promise<TextCompleteResult> {
  return text.complete({
    system: INTERVIEW_SYSTEM_PROMPT,
    messages: framed,
    maxTokens: MAX_TOKENS,
    json: true,
  });
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
    lastDropped: [...(input.state.lastDropped ?? [])],
    turnLog: [...(input.state.turnLog ?? [])],
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

  let completion: TextCompleteResult;
  try {
    completion = await completeOnce(input.text, framed);
  } catch {
    const reply = "I had trouble reaching the interview assistant. Try that answer again in a moment.";
    state.transcript.push({ role: "assistant", content: reply });
    pushTurnLog(state, {
      finishReason: null,
      parseOk: false,
      droppedPaths: [],
      model: "error",
      tokensIn: 0,
      tokensOut: 0,
    });
    return { state, reply, done: false };
  }

  addUsage(state, completion);

  if (budgetHit(state.tokenUsage, budget)) {
    const reply = TEXT_BUDGET_EXCEEDED_MESSAGE;
    state.transcript.push({ role: "assistant", content: reply });
    state.done = true;
    pushTurnLog(state, {
      finishReason: completion.finishReason ?? null,
      parseOk: false,
      droppedPaths: [],
      model: completion.model,
      tokensIn: completion.inputTokens,
      tokensOut: completion.outputTokens,
    });
    return { state, reply, done: true, budgetExceeded: true };
  }

  let json = parseJsonObject(completion.text);
  let parsed = parseModelTurnForgiving(json ?? {});

  // Repair once when there is no usable reply (truncated / invalid JSON / missing reply).
  if (!parsed.parseOk || !parsed.reply) {
    const parseError = parsed.error ?? "output was not valid JSON";
    try {
      const repair = await input.text.complete({
        system: INTERVIEW_SYSTEM_PROMPT,
        messages: [
          ...framed,
          { role: "assistant", content: completion.text || "(empty)" },
          {
            role: "user",
            content: `Your last output was not valid JSON: ${parseError}. Return only the JSON object.`,
          },
        ],
        maxTokens: MAX_TOKENS,
        json: true,
      });
      addUsage(state, repair);
      completion = {
        text: repair.text,
        inputTokens: completion.inputTokens + repair.inputTokens,
        outputTokens: completion.outputTokens + repair.outputTokens,
        model: repair.model,
        finishReason: repair.finishReason ?? completion.finishReason,
      };
      json = parseJsonObject(repair.text);
      parsed = parseModelTurnForgiving(json ?? {});
    } catch {
      // fall through to human fallback
    }
  }

  if (!parsed.parseOk || !parsed.reply) {
    const reply = HUMAN_FALLBACK;
    state.lastDropped = parsed.droppedPaths;
    state.transcript.push({ role: "assistant", content: reply });
    pushTurnLog(state, {
      finishReason: completion.finishReason ?? null,
      parseOk: false,
      droppedPaths: parsed.droppedPaths,
      model: completion.model,
      tokensIn: completion.inputTokens,
      tokensOut: completion.outputTokens,
    });
    return { state, reply, done: false };
  }

  state.collected = mergeCollected(state.collected, parsed.updates);
  state.lastDropped = parsed.droppedPaths;

  // Veterinary / healthcare signals.
  if (state.industry === "veterinary" || parsed.updates.compliance?.healthcareSensitive) {
    state.collected = mergeCollected(state.collected, {
      compliance: { healthcareSensitive: true, healthcareTouched: true },
    });
  }

  markAnswered(state, parsed.askedId);
  // Also mark any items now satisfied even if askedId was wrong/missing.
  for (const item of banksFor(state.industry)) {
    if (item.done(state.collected) && !state.answeredQuestions.includes(item.id) && !state.skippedQuestions.includes(item.id)) {
      state.answeredQuestions = [...state.answeredQuestions, item.id];
    }
  }

  const contradiction = contradictionQuestion(state.collected);
  state.openQuestions = refreshOpenQuestions(state);

  pushTurnLog(state, {
    finishReason: completion.finishReason ?? null,
    parseOk: true,
    droppedPaths: parsed.droppedPaths,
    model: completion.model,
    tokensIn: completion.inputTokens,
    tokensOut: completion.outputTokens,
  });

  if (contradiction) {
    state.stage = "clarify";
    state.transcript.push({ role: "assistant", content: contradiction });
    return { state, reply: contradiction, done: false };
  }

  const remainingRequired = requiredRemaining(state);
  if (parsed.done || remainingRequired.length === 0) {
    if (remainingRequired.length === 0) {
      const reply = parsed.done ? maybeSoftFollowUp(parsed.reply, parsed, json) : summaryReply(state);
      state.stage = "done";
      state.done = true;
      state.openQuestions = refreshOpenQuestions(state);
      state.transcript.push({ role: "assistant", content: reply });
      return { state, reply, done: true };
    }
  }

  state.stage = state.answeredQuestions.length === 0 ? "intro" : "collecting";
  const reply = maybeSoftFollowUp(parsed.reply, parsed, json);
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
