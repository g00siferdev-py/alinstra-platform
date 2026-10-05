"use server";

import {
  discardInterviewAction,
  finishInterviewAction,
  sendInterviewMessageAction,
} from "@/lib/interview-server";
import { requireAdmin } from "@/lib/session";
import type { Actor } from "@alinstra/db";

function actor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

export async function adminSendInterviewMessage(sessionId: string, message: string) {
  const session = await requireAdmin();
  const result = await sendInterviewMessageAction(actor(session), sessionId, message);
  if (!result || !result.ok) return result ?? { ok: false as const, error: "Could not send that." };
  const { getInterviewSession } = await import("@alinstra/db");
  const row = await getInterviewSession(actor(session), sessionId);
  const state = row.state as { collected?: Record<string, unknown> };
  return { ok: true as const, reply: result.reply, done: result.done, captured: state.collected ?? {} };
}

export async function adminFinishInterview(sessionId: string, clientId: string) {
  const session = await requireAdmin();
  return finishInterviewAction(actor(session), sessionId, `/admin/clients/${clientId}/wizard`);
}

export async function adminDiscardInterview(sessionId: string, clientId: string) {
  const session = await requireAdmin();
  return discardInterviewAction(actor(session), sessionId, `/admin/clients/${clientId}/wizard`);
}
