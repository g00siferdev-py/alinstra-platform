"use server";

import { log } from "@alinstra/config";
import {
  applyQuickUpdate,
  cancelChangeRequest,
  changeAllowance,
  previewQuickUpdate,
  submitChangeRequest,
  type Actor,
  type QuickUpdateInput,
} from "@alinstra/db";
import { enqueueSendAdminNotice } from "@alinstra/queue";
import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

function ownerActor(session: { user: { id: string; role: string; clientId?: string | null } }): Actor & { clientId: string } {
  if (session.user.role !== "client_owner" || !session.user.clientId) {
    throw new Error("Only the client owner can submit this.");
  }
  return { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function previewQuickUpdateAction(input: QuickUpdateInput) {
  const session = await requireUser();
  try {
    const result = await previewQuickUpdate(ownerActor(session), input);
    return { prompt: result.prompt, truncated: result.truncated, held: result.held, holdReason: result.holdReason };
  } catch (error) {
    return { error: message(error, "Could not preview that update.") };
  }
}

export async function applyQuickUpdateAction(input: QuickUpdateInput) {
  const session = await requireUser();
  try {
    const result = await applyQuickUpdate(ownerActor(session), input);
    if (result.notify) {
      try {
        await enqueueSendAdminNotice(result.notify);
      } catch (error) {
        log("error", "admin notice was not queued", { error: error instanceof Error ? error.name : "unknown" });
      }
    }
    revalidatePath("/home/business");
    return {
      status: result.status,
      holdReason: result.holdReason,
      prompt: result.prompt,
      truncated: result.truncated,
    };
  } catch (error) {
    return { error: message(error, "Could not apply that update.") };
  }
}

export async function allowanceAction() {
  const session = await requireUser();
  try {
    const actor = ownerActor(session);
    return await changeAllowance(actor, actor.clientId);
  } catch (error) {
    return { error: message(error, "Could not load the allowance.") };
  }
}

export async function submitChangeRequestAction(input: { category: string; description: string; confirmFee: boolean }) {
  const session = await requireUser();
  try {
    await submitChangeRequest(ownerActor(session), input);
    revalidatePath("/home/changes");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not submit that request.") };
  }
}

export async function cancelChangeRequestAction(id: string) {
  const session = await requireUser();
  try {
    await cancelChangeRequest(ownerActor(session), id);
    revalidatePath("/home/changes");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not cancel that request.") };
  }
}
