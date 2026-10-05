"use server";

import { getEnv } from "@alinstra/config";
import {
  activeInterviewForClient,
  discardInterviewSession,
  finishInterviewSession,
  postInterviewMessage,
  startInterviewSession,
  textInterviewConfig,
  textPlatformFor,
  type Actor,
} from "@alinstra/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type InterviewActionState =
  | { ok: true; reply?: string; done?: boolean; sessionId?: string }
  | { ok: false; error: string }
  | null;

function rethrowRedirect(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  ) {
    throw error;
  }
}

function configAndText() {
  const config = textInterviewConfig(getEnv());
  const text = textPlatformFor(config);
  if (!config.enabled || !text) {
    throw new Error("The interview assistant is not configured.");
  }
  return { config, text };
}

export async function ensureInterviewSession(actor: Actor, clientId: string, industry?: string | null) {
  const existing = await activeInterviewForClient(actor, clientId);
  if (existing) return existing;
  const { config, text } = configAndText();
  return startInterviewSession(actor, { clientId, industry, text, model: config.model });
}

export async function sendInterviewMessageAction(
  actor: Actor,
  sessionId: string,
  message: string,
): Promise<InterviewActionState> {
  try {
    const { config, text } = configAndText();
    const result = await postInterviewMessage(actor, {
      sessionId,
      message,
      text,
      budget: { inputTokens: config.budgetInputTokens, outputTokens: config.budgetOutputTokens },
    });
    return { ok: true, reply: result.reply, done: result.done, sessionId: result.session.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send that." };
  }
}

export async function finishInterviewAction(
  actor: Actor,
  sessionId: string,
  wizardHref: string,
): Promise<InterviewActionState> {
  try {
    const result = await finishInterviewSession(actor, sessionId);
    revalidatePath(wizardHref);
    redirect(`${wizardHref}?step=1`);
    return { ok: true, sessionId: result.draft.id };
  } catch (error) {
    rethrowRedirect(error);
    return { ok: false, error: error instanceof Error ? error.message : "Could not finish the interview." };
  }
}

export async function discardInterviewAction(
  actor: Actor,
  sessionId: string,
  returnHref: string,
): Promise<InterviewActionState> {
  try {
    await discardInterviewSession(actor, sessionId);
    redirect(returnHref);
    return { ok: true };
  } catch (error) {
    rethrowRedirect(error);
    return { ok: false, error: error instanceof Error ? error.message : "Could not discard the interview." };
  }
}

export function interviewEnabled(): boolean {
  return textInterviewConfig(getEnv()).enabled;
}
