"use server";

import { getEnv } from "@alinstra/config";
import {
  activeInterviewForClient,
  discardInterviewSession,
  finishInterviewSession,
  postInterviewMessage,
  resolveTextInterviewConfig,
  startInterviewSession,
  textPlatformFor,
  type Actor,
} from "@alinstra/db";
import type { InterviewActionState } from "@/lib/interview-config";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

function transcriptFromState(state: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  const row = state as { transcript?: Array<{ role: string; content: string }> };
  if (!Array.isArray(row?.transcript)) return [];
  return row.transcript
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({ role: turn.role as "user" | "assistant", content: turn.content }));
}

function capturedFromState(state: unknown): Record<string, unknown> {
  const row = state as { collected?: Record<string, unknown> };
  return row.collected ?? {};
}

async function configAndText() {
  const config = await resolveTextInterviewConfig(getEnv());
  const text = textPlatformFor(config);
  if (!config.enabled || !text) {
    throw new Error("The interview assistant is not configured.");
  }
  return { config, text };
}

export async function ensureInterviewSession(actor: Actor, clientId: string, industry?: string | null) {
  const existing = await activeInterviewForClient(actor, clientId);
  if (existing) return existing;
  const { config, text } = await configAndText();
  return startInterviewSession(actor, { clientId, industry, text, model: config.model });
}

export async function sendInterviewMessageAction(
  actor: Actor,
  sessionId: string,
  message: string,
  clientMessageId: string,
): Promise<InterviewActionState> {
  try {
    const { config, text } = await configAndText();
    const result = await postInterviewMessage(actor, {
      sessionId,
      message,
      clientMessageId,
      text,
      budget: { inputTokens: config.budgetInputTokens, outputTokens: config.budgetOutputTokens },
    });
    if (!result.ok) {
      return {
        ok: false,
        conflict: true,
        transcript: transcriptFromState(result.session.state),
        captured: capturedFromState(result.session.state),
        done: (result.session.state as { done?: boolean }).done === true || result.session.status !== "active",
      };
    }
    return {
      ok: true,
      reply: result.reply,
      done: result.done,
      sessionId: result.session.id,
      transcript: transcriptFromState(result.session.state),
      captured: capturedFromState(result.session.state),
    };
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
