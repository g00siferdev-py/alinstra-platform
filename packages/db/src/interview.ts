import {
  initialInterviewState,
  interviewGreeting,
  interviewTurn,
  mergeIntoDraft,
  normalizeInterviewState,
  resolveInterviewIndustry,
  type InterviewCollected,
  type InterviewIndustry,
  type InterviewState,
  type InterviewTurnError,
} from "@alinstra/agent";
import { log } from "@alinstra/config";
import {
  DEFAULT_TEXT_API_BASE,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TEXT_TOKEN_BUDGET,
  httpText,
  type TextPlatform,
} from "@alinstra/providers";
import type { Prisma } from "./generated/prisma/client";
import { getAppSettings, setAppSetting } from "./app-settings";
import { prisma } from "./client";
import { emptyWizardPayload, wizardPayloadSchema, type WizardPayload } from "./domain";
import { recordChange, type Actor } from "./changes";
import { assertTenantContext } from "./tenant";

/** Interview text calls get 40s; keep "no retry after a timeout" in httpText. */
const INTERVIEW_TEXT_TIMEOUT_MS = 40_000;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export const INTERVIEW_SETTING_KEYS = {
  textApiBase: "interview.textApiBase",
  textModel: "interview.textModel",
  textFallbackModel: "interview.textFallbackModel",
  budgetInputTokens: "interview.budgetInputTokens",
  budgetOutputTokens: "interview.budgetOutputTokens",
  reasoningEffort: "interview.reasoningEffort",
} as const;

export const INTERVIEW_STATUS = {
  active: "active",
  finished: "finished",
  discarded: "discarded",
} as const;

export type TextInterviewConfig = {
  enabled: boolean;
  apiBase: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  budgetInputTokens: number;
  budgetOutputTokens: number;
  /** OpenRouter reasoning. default = omit field. Code default is off. */
  reasoningEffort: "off" | "low" | "default";
};

/** Env-backed defaults. API key is always env-only. */
export function textInterviewConfig(env: {
  TEXT_API_KEY?: string;
  TEXT_API_BASE?: string;
  TEXT_MODEL?: string;
  TEXT_FALLBACK_MODEL?: string;
  TEXT_BUDGET_INPUT_TOKENS?: number;
  TEXT_BUDGET_OUTPUT_TOKENS?: number;
}): TextInterviewConfig {
  const apiKey = env.TEXT_API_KEY?.trim() ?? "";
  return {
    enabled: apiKey.length > 0,
    apiBase: env.TEXT_API_BASE?.trim() || DEFAULT_TEXT_API_BASE,
    apiKey,
    model: env.TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    fallbackModel: env.TEXT_FALLBACK_MODEL?.trim() || "",
    budgetInputTokens: env.TEXT_BUDGET_INPUT_TOKENS ?? DEFAULT_TEXT_TOKEN_BUDGET.inputTokens,
    budgetOutputTokens: env.TEXT_BUDGET_OUTPUT_TOKENS ?? DEFAULT_TEXT_TOKEN_BUDGET.outputTokens,
    reasoningEffort: "off",
  };
}

function settingString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function settingNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function settingReasoningEffort(value: unknown): "off" | "low" | "default" | null {
  if (value === "off" || value === "low" || value === "default") return value;
  return null;
}

/** Env defaults with AppSetting overrides (never overrides TEXT_API_KEY). */
export async function resolveTextInterviewConfig(env: {
  TEXT_API_KEY?: string;
  TEXT_API_BASE?: string;
  TEXT_MODEL?: string;
  TEXT_FALLBACK_MODEL?: string;
  TEXT_BUDGET_INPUT_TOKENS?: number;
  TEXT_BUDGET_OUTPUT_TOKENS?: number;
}): Promise<TextInterviewConfig> {
  const base = textInterviewConfig(env);
  const stored = await getAppSettings(Object.values(INTERVIEW_SETTING_KEYS));
  return {
    ...base,
    apiBase: settingString(stored[INTERVIEW_SETTING_KEYS.textApiBase]) ?? base.apiBase,
    model: settingString(stored[INTERVIEW_SETTING_KEYS.textModel]) ?? base.model,
    fallbackModel: settingString(stored[INTERVIEW_SETTING_KEYS.textFallbackModel]) ?? base.fallbackModel,
    budgetInputTokens: settingNumber(stored[INTERVIEW_SETTING_KEYS.budgetInputTokens]) ?? base.budgetInputTokens,
    budgetOutputTokens: settingNumber(stored[INTERVIEW_SETTING_KEYS.budgetOutputTokens]) ?? base.budgetOutputTokens,
    reasoningEffort: settingReasoningEffort(stored[INTERVIEW_SETTING_KEYS.reasoningEffort]) ?? base.reasoningEffort,
  };
}

export async function saveInterviewSettings(
  ctx: Actor,
  input: {
    textApiBase: string;
    textModel: string;
    textFallbackModel: string;
    budgetInputTokens: number;
    budgetOutputTokens: number;
    reasoningEffort: "off" | "low" | "default";
  },
) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can change interview settings.");
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.textApiBase, input.textApiBase.trim() || DEFAULT_TEXT_API_BASE);
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.textModel, input.textModel.trim() || DEFAULT_TEXT_MODEL);
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.textFallbackModel, input.textFallbackModel.trim());
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.budgetInputTokens, input.budgetInputTokens);
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.budgetOutputTokens, input.budgetOutputTokens);
  const effort = settingReasoningEffort(input.reasoningEffort) ?? "off";
  await setAppSetting(ctx, INTERVIEW_SETTING_KEYS.reasoningEffort, effort);
}

export function textPlatformFor(config: TextInterviewConfig): TextPlatform | null {
  if (!config.enabled) return null;
  return httpText({
    apiKey: config.apiKey,
    baseUrl: config.apiBase,
    model: config.model,
    fallbackModel: config.fallbackModel || undefined,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: INTERVIEW_TEXT_TIMEOUT_MS,
  });
}

function asState(value: unknown): InterviewState {
  const row = value as InterviewState;
  if (!row || typeof row !== "object" || !Array.isArray(row.transcript)) {
    throw new Error("Interview state is invalid.");
  }
  return normalizeInterviewState(row);
}

function actorCanAccessClient(ctx: Actor, clientId: string, client: { id: string }): void {
  assertTenantContext(ctx);
  if (ctx.role === "admin") return;
  if (ctx.role === "client_owner" && ctx.clientId === clientId && client.id === clientId) return;
  throw new Error("Not allowed.");
}

async function loadClientForInterview(ctx: Actor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, archivedAt: null },
    select: {
      id: true,
      name: true,
      industry: true,
      wizardSubmittedAt: true,
      planId: true,
      plan: { select: { code: true } },
      wizardDraft: { select: { id: true, payload: true, currentStep: true, discardedAt: true, updatedAt: true } },
    },
  });
  if (!client) throw new Error("Client not found.");
  actorCanAccessClient(ctx, clientId, client);
  if (ctx.role === "client_owner" && client.wizardSubmittedAt) {
    throw new Error("The receptionist setup interview is only available before the wizard is submitted.");
  }
  return client;
}

export async function startInterviewSession(
  ctx: Actor,
  input: { clientId: string; industry?: string | null; text: TextPlatform; model: string },
) {
  const client = await loadClientForInterview(ctx, input.clientId);
  const draft = client.wizardDraft;
  if (!draft || draft.discardedAt) throw new Error("Start the wizard draft before the interview.");

  const industry: InterviewIndustry = resolveInterviewIndustry(input.industry ?? client.industry);
  const planCode = client.plan?.code ?? null;
  const state = initialInterviewState(industry, { planCode });
  const greeting = interviewGreeting(industry);
  state.transcript = [{ role: "assistant", content: greeting }];
  state.stage = "intro";

  // Seed business name / industry from the client when empty.
  const seed: InterviewCollected = {
    business: {
      name: client.name,
      ...(client.industry ? { industry: client.industry } : {}),
    },
  };
  state.collected = { ...state.collected, ...seed };

  return prisma.interviewSession.create({
    data: {
      clientId: client.id,
      draftId: draft.id,
      industry,
      state: json(state),
      status: INTERVIEW_STATUS.active,
      model: input.model,
      tokensIn: 0,
      tokensOut: 0,
      version: 0,
    },
  });
}

export async function getInterviewSession(ctx: Actor, sessionId: string) {
  assertTenantContext(ctx);
  const session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
  if (!session?.clientId) throw new Error("Interview not found.");
  await loadClientForInterview(ctx, session.clientId);
  return session;
}

export async function activeInterviewForClient(ctx: Actor, clientId: string) {
  await loadClientForInterview(ctx, clientId);
  return prisma.interviewSession.findFirst({
    where: { clientId, status: INTERVIEW_STATUS.active },
    orderBy: { createdAt: "desc" },
  });
}

/** Latest finished interview for a client (owner setup review needs-review lines). */
export async function latestFinishedInterviewForClient(ctx: Actor, clientId: string) {
  await loadClientForInterview(ctx, clientId);
  return prisma.interviewSession.findFirst({
    where: { clientId, status: INTERVIEW_STATUS.finished },
    orderBy: { finishedAt: "desc" },
  });
}

export type PostInterviewMessageResult =
  | {
      ok: true;
      session: Awaited<ReturnType<typeof getInterviewSession>>;
      reply: string;
      done: boolean;
      budgetExceeded: boolean;
    }
  | {
      ok: false;
      conflict: true;
      session: Awaited<ReturnType<typeof getInterviewSession>>;
    };

export async function postInterviewMessage(
  ctx: Actor,
  input: {
    sessionId: string;
    message: string;
    clientMessageId: string;
    text: TextPlatform;
    budget: { inputTokens: number; outputTokens: number };
  },
): Promise<PostInterviewMessageResult> {
  const session = await getInterviewSession(ctx, input.sessionId);
  if (session.status !== INTERVIEW_STATUS.active) throw new Error("This interview is no longer active.");

  const clientMessageId = input.clientMessageId.trim();
  if (!clientMessageId) throw new Error("clientMessageId is required.");

  const state = asState(session.state);

  // Idempotency: same client message id → return stored reply without calling the model.
  if (state.lastClientMessageId === clientMessageId && state.lastAssistantReply) {
    return {
      ok: true,
      session,
      reply: state.lastAssistantReply,
      done: state.done,
      budgetExceeded: false,
    };
  }

  const result = await interviewTurn({
    state,
    userMessage: input.message,
    text: input.text,
    budget: input.budget,
  });

  const lastLog = result.state.turnLog?.[result.state.turnLog.length - 1];
  if (lastLog?.error) {
    log("warn", "interview.turn_failed", {
      sessionId: session.id,
      error: lastLog.error as InterviewTurnError,
      model: lastLog.model,
    });
  }
  if (lastLog?.capabilityFlag) {
    log("warn", "interview.capability_claim", {
      sessionId: session.id,
      questionId: lastLog.currentQuestionId ?? null,
    });
  }

  result.state.lastClientMessageId = clientMessageId;
  result.state.lastAssistantReply = result.reply;

  const updatedCount = await prisma.interviewSession.updateMany({
    where: { id: session.id, version: session.version },
    data: {
      state: json(result.state),
      tokensIn: result.state.tokenUsage.inputTokens,
      tokensOut: result.state.tokenUsage.outputTokens,
      status: result.done ? INTERVIEW_STATUS.finished : INTERVIEW_STATUS.active,
      finishedAt: result.done ? new Date() : null,
      version: { increment: 1 },
    },
  });

  if (updatedCount.count === 0) {
    const fresh = await getInterviewSession(ctx, session.id);
    return { ok: false, conflict: true, session: fresh };
  }

  const updated = await getInterviewSession(ctx, session.id);
  return {
    ok: true,
    session: updated,
    reply: result.reply,
    done: result.done,
    budgetExceeded: result.budgetExceeded === true,
  };
}

export async function discardInterviewSession(ctx: Actor, sessionId: string) {
  const session = await getInterviewSession(ctx, sessionId);
  if (session.status !== INTERVIEW_STATUS.active) return session;
  return prisma.interviewSession.update({
    where: { id: session.id },
    data: { status: INTERVIEW_STATUS.discarded, finishedAt: new Date() },
  });
}

/**
 * Merge interview collected fields into WizardDraft where draft fields are empty.
 * Returns the wizard path step (always 1 for review).
 */
export async function finishInterviewSession(ctx: Actor, sessionId: string) {
  const session = await getInterviewSession(ctx, sessionId);
  if (!session.clientId) throw new Error("Interview has no client.");
  const client = await loadClientForInterview(ctx, session.clientId);
  const draft = client.wizardDraft;
  if (!draft || draft.discardedAt) throw new Error("Wizard draft not found.");

  const state = asState(session.state);
  const currentParsed = wizardPayloadSchema.safeParse(draft.payload);
  const current = currentParsed.success ? currentParsed.data : emptyWizardPayload();
  const merged = mergeIntoDraft(current as WizardPayload & Record<string, unknown>, state.collected) as WizardPayload;
  // Ensure healthcare flag sticks when the interview set it.
  if (state.collected.compliance?.healthcareSensitive) {
    merged.compliance = {
      ...merged.compliance,
      healthcareSensitive: true,
      healthcareTouched: true,
    };
  }
  const payload = wizardPayloadSchema.parse(merged);

  const updatedDraft = await prisma.$transaction(async (tx) => {
    const next = await tx.wizardDraft.update({
      where: { id: draft.id },
      data: { payload: json(payload), currentStep: 1 },
    });
    await tx.interviewSession.update({
      where: { id: session.id },
      data: {
        status: INTERVIEW_STATUS.finished,
        finishedAt: session.finishedAt ?? new Date(),
        state: json(state),
      },
    });
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "interview.finished",
      entityType: "interview_session",
      entityId: session.id,
      summary: `Finished onboarding interview (${session.industry})`,
      after: { industry: session.industry, tokensIn: session.tokensIn, tokensOut: session.tokensOut },
    });
    return next;
  });

  return { draft: updatedDraft, clientId: client.id };
}

export async function listInterviewSessions(ctx: Actor, take = 50) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can list interviews.");
  return prisma.interviewSession.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { client: { select: { id: true, name: true } } },
  });
}
