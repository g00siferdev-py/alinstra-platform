"use server";

import {
  discardInterviewAction,
  finishInterviewAction,
  sendInterviewMessageAction,
} from "@/lib/interview-server";
import { requireUser } from "@/lib/session";
import { getInterviewSession, type Actor } from "@alinstra/db";
import { notFound } from "next/navigation";

async function ownerActor(): Promise<Actor> {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  return { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
}

export async function ownerSendInterviewMessage(sessionId: string, message: string) {
  const actor = await ownerActor();
  const result = await sendInterviewMessageAction(actor, sessionId, message);
  if (!result || !result.ok) return result ?? { ok: false as const, error: "Could not send that." };
  const row = await getInterviewSession(actor, sessionId);
  const state = row.state as { collected?: Record<string, unknown> };
  return { ok: true as const, reply: result.reply, done: result.done, captured: state.collected ?? {} };
}

export async function ownerFinishInterview(sessionId: string) {
  const actor = await ownerActor();
  return finishInterviewAction(actor, sessionId, "/home/business");
}

export async function ownerDiscardInterview(sessionId: string) {
  const actor = await ownerActor();
  return discardInterviewAction(actor, sessionId, "/home/business");
}
