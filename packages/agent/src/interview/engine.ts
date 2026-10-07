import {
  DEFAULT_TEXT_TOKEN_BUDGET,
  ProviderRequestError,
  TEXT_BUDGET_EXCEEDED_MESSAGE,
  parseJsonObject,
  type TextCompleteResult,
  type TextPlatform,
} from "@alinstra/providers";
import { banksFor } from "./banks";
import type { BankItem } from "./banks/types";
import { CALENDAR_BOOKING_AVAILABLE, detectsCapabilityClaim } from "./capabilities";
import {
  getCollectedField,
  primaryStringField,
  setCollectedField,
  topicLabel,
  trimToFieldMax,
} from "./fields";
import { contradictionQuestion, mergeCollected } from "./merge";
import { buildInterviewSystemPrompt, buildInterviewUserPayload } from "./prompt";
import type {
  AnswerStatus,
  InterviewIndustry,
  InterviewState,
  InterviewTurnError,
  InterviewTurnLogEntry,
  InterviewTurnResult,
  TokenUsage,
} from "./types";
import { parseModelTurnForgiving, type ForgivingTurnResult } from "./validate";

const MAX_TOKENS = 2000;
const HUMAN_FALLBACK = "Sorry, I lost my place for a second. Could you say that again?";
const SKIP_RE = /^(skip|next|pass)\b/i;
const SAME_THING_RE = /^(same( thing)?|same as (before|above|that)|ditto)[.!]?$/i;
const STUCK_RE = /\b(stuck|already asked|same thing over|asking me the same)\b/i;

export type InterviewBudget = {
  inputTokens: number;
  outputTokens: number;
};

export type InitialInterviewOptions = {
  planCode?: string | null;
};

function firstBankItem(industry: InterviewIndustry): BankItem | undefined {
  return banksFor(industry)[0];
}

function applyBookingDefaults(state: InterviewState): void {
  if (CALENDAR_BOOKING_AVAILABLE) return;
  state.collected = mergeCollected(state.collected, {
    features: { bookingMode: "request_only" },
  });
  if (!state.answeredQuestions.includes("gen.booking")) {
    state.answeredQuestions = [...state.answeredQuestions, "gen.booking"];
  }
  state.openQuestions = refreshOpenQuestions(state);
}

export function initialInterviewState(
  industry: InterviewIndustry,
  options: InitialInterviewOptions = {},
): InterviewState {
  const items = banksFor(industry);
  const first = firstBankItem(industry);
  const firstId = first?.id ?? null;
  const state: InterviewState = {
    industry,
    stage: "intro",
    collected: {},
    transcript: [],
    openQuestions: items.map((item) => item.id),
    skippedQuestions: [],
    answeredQuestions: [],
    needsReviewQuestions: [],
    currentQuestionId: firstId,
    askCounts: firstId ? { [firstId]: 1 } : {},
    planCode: options.planCode ?? null,
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    done: false,
    lastDropped: [],
    turnLog: [],
  };
  applyBookingDefaults(state);
  return state;
}

/** Back-compat for sessions started before Phase I.1 fields existed. */
export function normalizeInterviewState(state: InterviewState): InterviewState {
  const next: InterviewState = {
    ...state,
    collected: { ...state.collected },
    transcript: [...state.transcript],
    openQuestions: [...state.openQuestions],
    skippedQuestions: [...state.skippedQuestions],
    answeredQuestions: [...state.answeredQuestions],
    needsReviewQuestions: [...(state.needsReviewQuestions ?? [])],
    askCounts: { ...(state.askCounts ?? {}) },
    planCode: state.planCode ?? null,
    tokenUsage: { ...state.tokenUsage },
    lastDropped: [...(state.lastDropped ?? [])],
    turnLog: [...(state.turnLog ?? [])],
  };

  applyBookingDefaults(next);
  next.openQuestions = refreshOpenQuestions(next);

  if (next.currentQuestionId == null || next.currentQuestionId === undefined) {
    const openRequired = banksFor(next.industry).find(
      (item) => item.required && next.openQuestions.includes(item.id),
    );
    const openAny = banksFor(next.industry).find((item) => next.openQuestions.includes(item.id));
    next.currentQuestionId = openRequired?.id ?? openAny?.id ?? null;
  }

  return next;
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

function markSkipped(state: InterviewState, itemId: string): void {
  if (!state.skippedQuestions.includes(itemId)) {
    state.skippedQuestions = [...state.skippedQuestions, itemId];
  }
  const item = banksFor(state.industry).find((row) => row.id === itemId);
  if (item?.required && !state.needsReviewQuestions.includes(itemId)) {
    state.needsReviewQuestions = [...state.needsReviewQuestions, itemId];
  }
  state.answeredQuestions = state.answeredQuestions.filter((id) => id !== itemId);
}

function requiredRemaining(state: InterviewState): string[] {
  return banksFor(state.industry)
    .filter((item) => item.required && !item.done(state.collected) && !state.skippedQuestions.includes(item.id))
    .map((item) => item.id);
}

function nextOpenItem(state: InterviewState): BankItem | undefined {
  const items = banksFor(state.industry);
  const open = new Set(refreshOpenQuestions(state));
  const required = items.find((item) => item.required && open.has(item.id));
  if (required) return required;
  return items.find((item) => open.has(item.id));
}

function previousAnsweredItem(state: InterviewState, currentId: string | null): BankItem | undefined {
  const items = banksFor(state.industry);
  const answered = state.answeredQuestions.filter((id) => id !== currentId);
  for (let i = answered.length - 1; i >= 0; i -= 1) {
    const item = items.find((row) => row.id === answered[i]);
    if (item && primaryStringField(item.fields)) return item;
  }
  return undefined;
}

function progressLine(state: InterviewState): string {
  const items = banksFor(state.industry);
  const covered = [...state.answeredQuestions]
    .map((id) => {
      const item = items.find((row) => row.id === id);
      return item ? topicLabel(item.id, item.question) : null;
    })
    .filter(Boolean);
  const next = state.currentQuestionId
    ? items.find((item) => item.id === state.currentQuestionId)
    : undefined;
  const nextLabel = next ? topicLabel(next.id, next.question) : null;
  const soFar = covered.length > 0 ? `So far: ${covered.join(", ")}.` : "So far: nothing yet.";
  return nextLabel ? `${soFar} Next: ${nextLabel}.` : soFar;
}

export function summaryReply(state: InterviewState): string {
  const items = banksFor(state.industry);
  const bits: string[] = ["Thanks — I have enough to draft your receptionist setup."];

  for (const id of state.answeredQuestions) {
    const item = items.find((row) => row.id === id);
    if (!item) continue;
    if (id === "gen.booking") {
      bits.push("Appointment requests: Ava takes them and emails them to you to confirm.");
      continue;
    }
    const label = topicLabel(item.id, item.question);
    bits.push(`I captured your ${label}.`);
  }

  for (const id of state.needsReviewQuestions) {
    const item = items.find((row) => row.id === id);
    if (!item) continue;
    const label = topicLabel(item.id, item.question);
    bits.push(`You skipped ${label}; you can fill it in on the next screen.`);
  }

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

function maybeSoftFollowUp(confirmation: string, parsed: ForgivingTurnResult, rawJson: unknown): string {
  if (parsed.droppedPaths.length === 0) return confirmation;
  if (keptUpdateCount(parsed.updates) > 0) return confirmation;
  if (!updatesWereAttempted(rawJson)) return confirmation;
  if (/rephrase|say that|one short|could you/i.test(confirmation)) return confirmation;
  return `${confirmation} Could you put that last detail in one short phrase?`;
}

function pushTurnLog(state: InterviewState, entry: InterviewTurnLogEntry): void {
  state.turnLog = [...(state.turnLog ?? []), entry];
}

function addUsage(state: InterviewState, completion: TextCompleteResult): void {
  state.tokenUsage = {
    inputTokens: state.tokenUsage.inputTokens + completion.inputTokens,
    outputTokens: state.tokenUsage.outputTokens + completion.outputTokens,
  };
}

export function classifyInterviewError(error: unknown): InterviewTurnError {
  if (error instanceof ProviderRequestError) {
    const status = error.status;
    if (status === 408) return "timeout";
    if (status === 401) return "http_401";
    if (status === 402) return "http_402";
    if (status === 429) return "http_429";
    if (status >= 400 && status < 500) return "http_4xx";
    if (status >= 500) return "http_5xx";
    return "unknown";
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return "timeout";
    if (/network|fetch failed|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(error.message)) return "network";
  }
  return "unknown";
}

async function completeOnce(
  text: TextPlatform,
  system: string,
  framed: { role: "user" | "assistant"; content: string }[],
): Promise<TextCompleteResult> {
  return text.complete({
    system,
    messages: framed,
    maxTokens: MAX_TOKENS,
    json: true,
  });
}

function joinReply(confirmation: string | null | undefined, next: string): string {
  const left = (confirmation ?? "").trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

function rewordQuestion(item: BankItem): string {
  const q = item.question.replace(/\?+\s*$/, "").trim();
  return `Just to make sure I have it right: ${q}?`;
}

function askCount(state: InterviewState, id: string | null): number {
  if (!id) return 0;
  return state.askCounts[id] ?? 0;
}

function bumpAskCount(state: InterviewState, id: string): void {
  state.askCounts = { ...state.askCounts, [id]: (state.askCounts[id] ?? 0) + 1 };
}

function advanceTo(state: InterviewState, item: BankItem | undefined): void {
  if (!item) {
    state.currentQuestionId = null;
    return;
  }
  state.currentQuestionId = item.id;
  bumpAskCount(state, item.id);
}

function finishIfDone(state: InterviewState, confirmation: string | null): InterviewTurnResult | null {
  const remaining = requiredRemaining(state);
  if (remaining.length > 0) return null;
  const reply = summaryReply(state);
  void confirmation;
  state.stage = "done";
  state.done = true;
  state.openQuestions = refreshOpenQuestions(state);
  state.currentQuestionId = null;
  state.transcript.push({ role: "assistant", content: reply });
  state.lastAssistantReply = reply;
  return { state, reply, done: true };
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
  const state = normalizeInterviewState(input.state);

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

  const system = buildInterviewSystemPrompt(state.planCode);
  const messages = state.transcript.map((turn) => ({ role: turn.role, content: turn.content }));
  const framed = [
    ...messages.slice(0, -1).slice(-12),
    { role: "user" as const, content: buildInterviewUserPayload(state, userMessage) },
  ];

  let completion: TextCompleteResult;
  try {
    completion = await completeOnce(input.text, system, framed);
  } catch (error) {
    const classified = classifyInterviewError(error);
    const reply = "I had trouble reaching the interview assistant. Try that answer again in a moment.";
    state.transcript.push({ role: "assistant", content: reply });
    state.lastAssistantReply = reply;
    pushTurnLog(state, {
      finishReason: null,
      parseOk: false,
      droppedPaths: [],
      droppedReasons: [],
      model: "error",
      tokensIn: 0,
      tokensOut: 0,
      currentQuestionId: state.currentQuestionId,
      askCount: askCount(state, state.currentQuestionId),
      answerStatus: null,
      fallback: null,
      error: classified,
      capabilityFlag: false,
    });
    return { state, reply, done: false };
  }

  addUsage(state, completion);

  if (budgetHit(state.tokenUsage, budget)) {
    const reply = TEXT_BUDGET_EXCEEDED_MESSAGE;
    state.transcript.push({ role: "assistant", content: reply });
    state.lastAssistantReply = reply;
    state.done = true;
    pushTurnLog(state, {
      finishReason: completion.finishReason ?? null,
      parseOk: false,
      droppedPaths: [],
      droppedReasons: [],
      model: completion.model,
      tokensIn: completion.inputTokens,
      tokensOut: completion.outputTokens,
      currentQuestionId: state.currentQuestionId,
      askCount: askCount(state, state.currentQuestionId),
      answerStatus: null,
      fallback: null,
      error: null,
      capabilityFlag: false,
    });
    return { state, reply, done: true, budgetExceeded: true };
  }

  let json = parseJsonObject(completion.text);
  let parsed = parseModelTurnForgiving(json ?? {});

  if (!parsed.parseOk || !parsed.confirmation) {
    const parseError = parsed.error ?? "output was not valid JSON";
    try {
      const repair = await input.text.complete({
        system,
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

  if (!parsed.parseOk || !parsed.confirmation) {
    const reply = HUMAN_FALLBACK;
    state.lastDropped = parsed.droppedPaths;
    state.transcript.push({ role: "assistant", content: reply });
    state.lastAssistantReply = reply;
    pushTurnLog(state, {
      finishReason: completion.finishReason ?? null,
      parseOk: false,
      droppedPaths: parsed.droppedPaths,
      droppedReasons: parsed.droppedReasons,
      model: completion.model,
      tokensIn: completion.inputTokens,
      tokensOut: completion.outputTokens,
      currentQuestionId: state.currentQuestionId,
      askCount: askCount(state, state.currentQuestionId),
      answerStatus: parsed.answerStatus,
      fallback: null,
      error: null,
      capabilityFlag: false,
    });
    return { state, reply, done: false };
  }

  state.collected = mergeCollected(state.collected, parsed.updates);
  state.lastDropped = parsed.droppedPaths;

  if (state.industry === "veterinary" || parsed.updates.compliance?.healthcareSensitive) {
    state.collected = mergeCollected(state.collected, {
      compliance: { healthcareSensitive: true, healthcareTouched: true },
    });
  }

  const currentId = state.currentQuestionId;
  const currentItem = currentId
    ? banksFor(state.industry).find((item) => item.id === currentId)
    : undefined;

  let fallback: "raw" | "same" | null = null;
  let answerStatus: AnswerStatus = parsed.answerStatus;
  const sameThingCue = SAME_THING_RE.test(userMessage);

  // 1. Skip
  const skipCue = SKIP_RE.test(userMessage) || parsed.answerStatus === "skipped";
  if (skipCue && currentId) {
    markSkipped(state, currentId);
    answerStatus = "skipped";
  }

  // 2. "Same thing."
  if (!skipCue && sameThingCue && currentItem) {
    const prev = previousAnsweredItem(state, currentId);
    const dest = primaryStringField(currentItem.fields);
    const src = prev ? primaryStringField(prev.fields) : null;
    if (dest && src) {
      const prevValue = getCollectedField(state.collected, src);
      if (typeof prevValue === "string" && prevValue.trim()) {
        state.collected = setCollectedField(state.collected, dest, trimToFieldMax(prevValue, dest));
        fallback = "same";
        answerStatus = "answered";
      }
    }
  }

  // 3. Raw fallback (never for skip / same-thing cues)
  if (
    !skipCue &&
    !sameThingCue &&
    fallback !== "same" &&
    parsed.answerStatus === "answered" &&
    currentItem &&
    !currentItem.done(state.collected)
  ) {
    const dest = primaryStringField(currentItem.fields);
    if (dest) {
      state.collected = setCollectedField(state.collected, dest, trimToFieldMax(userMessage, dest));
      fallback = "raw";
    }
  }

  // Mark any items now satisfied.
  for (const item of banksFor(state.industry)) {
    if (
      item.done(state.collected) &&
      !state.answeredQuestions.includes(item.id) &&
      !state.skippedQuestions.includes(item.id)
    ) {
      state.answeredQuestions = [...state.answeredQuestions, item.id];
    }
  }
  if (currentId) markAnswered(state, currentId);

  const contradiction = contradictionQuestion(state.collected);
  state.openQuestions = refreshOpenQuestions(state);

  const confirmation = maybeSoftFollowUp(parsed.confirmation, parsed, json);
  const capabilityFlag =
    detectsCapabilityClaim(confirmation) || detectsCapabilityClaim(parsed.followUp);

  const baseLog: Omit<InterviewTurnLogEntry, "capabilityFlag"> & { capabilityFlag?: boolean } = {
    finishReason: completion.finishReason ?? null,
    parseOk: true,
    droppedPaths: parsed.droppedPaths,
    droppedReasons: parsed.droppedReasons,
    model: completion.model,
    tokensIn: completion.inputTokens,
    tokensOut: completion.outputTokens,
    currentQuestionId: currentId,
    askCount: askCount(state, currentId),
    answerStatus,
    fallback,
    error: null,
    capabilityFlag,
  };

  if (contradiction) {
    state.stage = "clarify";
    state.transcript.push({ role: "assistant", content: contradiction });
    state.lastAssistantReply = contradiction;
    pushTurnLog(state, { ...baseLog, capabilityFlag: detectsCapabilityClaim(contradiction) || capabilityFlag });
    return { state, reply: contradiction, done: false };
  }

  // After skip → advance immediately
  if (skipCue && currentId) {
    state.openQuestions = refreshOpenQuestions(state);
    const finished = finishIfDone(state, confirmation);
    if (finished) {
      pushTurnLog(state, baseLog);
      return finished;
    }
    const next = nextOpenItem(state);
    advanceTo(state, next);
    state.openQuestions = refreshOpenQuestions(state);
    const reply = next ? joinReply(confirmation, next.question) : summaryReply(state);
    if (!next) {
      state.done = true;
      state.stage = "done";
    } else {
      state.stage = "collecting";
    }
    state.transcript.push({ role: "assistant", content: reply });
    state.lastAssistantReply = reply;
    pushTurnLog(state, {
      ...baseLog,
      capabilityFlag: detectsCapabilityClaim(reply) || capabilityFlag,
    });
    return { state, reply, done: state.done };
  }

  const counts = askCount(state, currentId);
  const stayUnclear =
    currentItem &&
    currentId &&
    !currentItem.done(state.collected) &&
    !state.skippedQuestions.includes(currentId) &&
    (answerStatus === "unclear" ||
      answerStatus === "off_topic" ||
      Boolean(parsed.followUp)) &&
    counts < 2;

  // 4. Unclear / off-topic (under two-ask cap)
  if (stayUnclear && currentItem && currentId) {
    bumpAskCount(state, currentId);
    let reply: string;
    if (answerStatus === "off_topic" || STUCK_RE.test(userMessage)) {
      reply = joinReply(
        "Sorry about that — I got turned around.",
        `${progressLine(state)} ${currentItem.question}`,
      );
    } else {
      const clarify = parsed.followUp?.trim() || rewordQuestion(currentItem);
      reply = joinReply(confirmation, clarify);
    }
    state.stage = "clarify";
    state.transcript.push({ role: "assistant", content: reply });
    state.lastAssistantReply = reply;
    pushTurnLog(state, {
      ...baseLog,
      askCount: askCount(state, currentId),
      capabilityFlag: detectsCapabilityClaim(reply) || capabilityFlag,
    });
    return { state, reply, done: false };
  }

  // 5. Two-ask cap
  if (
    currentItem &&
    currentId &&
    !currentItem.done(state.collected) &&
    !state.skippedQuestions.includes(currentId) &&
    counts >= 2
  ) {
    markSkipped(state, currentId);
    state.openQuestions = refreshOpenQuestions(state);
  }

  // 6. Advance (or finish)
  state.openQuestions = refreshOpenQuestions(state);
  const finished = finishIfDone(state, confirmation);
  if (finished) {
    pushTurnLog(state, baseLog);
    return finished;
  }

  // Current item answered → clear it from current before picking next
  if (currentId && (state.answeredQuestions.includes(currentId) || state.skippedQuestions.includes(currentId))) {
    state.currentQuestionId = null;
  }

  const next = nextOpenItem(state);
  advanceTo(state, next);
  state.openQuestions = refreshOpenQuestions(state);
  state.stage = state.answeredQuestions.length === 0 ? "intro" : "collecting";

  const reply = next ? joinReply(confirmation, next.question) : summaryReply(state);
  if (!next) {
    state.done = true;
    state.stage = "done";
  }
  state.transcript.push({ role: "assistant", content: reply });
  state.lastAssistantReply = reply;
  pushTurnLog(state, {
    ...baseLog,
    capabilityFlag: detectsCapabilityClaim(reply) || capabilityFlag,
  });
  return { state, reply, done: state.done };
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
