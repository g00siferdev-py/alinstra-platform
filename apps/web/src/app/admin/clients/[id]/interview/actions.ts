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

export async function adminSendInterviewMessage(
  sessionId: string,
  message: string,
  clientMessageId: string,
) {
  const session = await requireAdmin();
  return sendInterviewMessageAction(actor(session), sessionId, message, clientMessageId);
}

export async function adminFinishInterview(sessionId: string, clientId: string) {
  const session = await requireAdmin();
  return finishInterviewAction(actor(session), sessionId, `/admin/clients/${clientId}/wizard`);
}

export async function adminDiscardInterview(sessionId: string, clientId: string) {
  const session = await requireAdmin();
  return discardInterviewAction(actor(session), sessionId, `/admin/clients/${clientId}/wizard`);
}
