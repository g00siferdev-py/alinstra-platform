"use server";

import {
  discardInterviewAction,
  finishInterviewAction,
  sendInterviewMessageAction,
} from "@/lib/interview-server";
import { requireUser } from "@/lib/session";
import type { Actor } from "@alinstra/db";
import { notFound } from "next/navigation";

async function ownerActor(): Promise<Actor> {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  return { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
}

export async function ownerSendInterviewMessage(
  sessionId: string,
  message: string,
  clientMessageId: string,
) {
  const actor = await ownerActor();
  return sendInterviewMessageAction(actor, sessionId, message, clientMessageId);
}

export async function ownerFinishInterview(sessionId: string) {
  const actor = await ownerActor();
  return finishInterviewAction(actor, sessionId, "/home/business/setup");
}

export async function ownerDiscardInterview(sessionId: string) {
  const actor = await ownerActor();
  return discardInterviewAction(actor, sessionId, "/home/business");
}
