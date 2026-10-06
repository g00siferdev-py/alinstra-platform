"use server";

import type { EditStepResult } from "@/app/admin/actions";
import { consumeOwnerEditLimit, retryAfterText } from "@alinstra/auth/rate-limit";
import { log } from "@alinstra/config";
import {
  applyQuickUpdate,
  cancelChangeRequest,
  changeAllowance,
  editClientStep,
  previewQuickUpdate,
  setCallAccess,
  setCallRetention,
  submitChangeRequest,
  type Actor,
  type QuickUpdateInput,
} from "@alinstra/db";
import { enqueueSendAdminNotice, enqueueSyncAgent } from "@alinstra/queue";
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

/** Quick updates and change requests share one bucket: 30 per hour per owner. Staff are refused before they count. */
async function ownerEditLimited(actor: { id: string }): Promise<{ error: string; retryAfterSeconds: number } | null> {
  const decision = await consumeOwnerEditLimit(actor.id);
  if (!decision.limited) return null;
  return { error: `Too many edits this hour. Try again in ${retryAfterText(decision.retryAfterSeconds)}.`, retryAfterSeconds: decision.retryAfterSeconds };
}

export async function applyQuickUpdateAction(input: QuickUpdateInput) {
  const session = await requireUser();
  try {
    const actor = ownerActor(session);
    const limited = await ownerEditLimited(actor);
    if (limited) return limited;
    const result = await applyQuickUpdate(actor, input);
    if (result.sync) {
      try {
        await enqueueSyncAgent({ clientId: session.user.clientId ?? "" });
      } catch (error) {
        log("error", "agent sync was not queued", { error: error instanceof Error ? error.name : "unknown" });
      }
    }
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
    const actor = ownerActor(session);
    const limited = await ownerEditLimited(actor);
    if (limited) return limited;
    await submitChangeRequest(actor, input);
    revalidatePath("/home/changes");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not submit that request.") };
  }
}

/** Owner grants or removes a staff member's access to call transcripts and recordings. */
export async function setCallAccessAction(input: { userId: string; canViewCalls: boolean }) {
  const session = await requireUser();
  try {
    const result = await setCallAccess(ownerActor(session), input);
    revalidatePath("/home/team");
    return { ok: true, changed: result.changed };
  } catch (error) {
    return { error: message(error, "Could not change call access.") };
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

/**
 * Owner edit of one wizard step on their own client. Staff and foreign clients are refused inside
 * `editClientStep` / `ownerActor`. Plan and Compliance stay blocked with the support-email hint.
 */
export async function ownerEditClientStepAction(input: { clientId: string; step: number; payload: unknown }): Promise<EditStepResult> {
  const session = await requireUser();
  try {
    const actor = ownerActor(session);
    if (input.clientId !== actor.clientId) {
      return { ok: false, error: "That client is not available." };
    }
    const result = await editClientStep(actor, input);
    if (result.sync) {
      await enqueueSyncAgent({ clientId: actor.clientId }).catch((error: unknown) => {
        log("warn", "sync enqueue failed after owner edit", { clientId: actor.clientId, error: error instanceof Error ? error.message : "unknown" });
      });
    }
    revalidatePath("/home/business");
    revalidatePath(`/home/business/edit/${input.step}`);
    return {
      ok: true,
      title: result.title,
      changedCount: result.changed.length,
      configVersion: result.configVersion,
      sync: result.sync,
      stripeWarning: result.stripeWarning,
      held: result.held,
      holdReason: result.holdReason,
    };
  } catch (error) {
    return { ok: false, error: message(error, "Check this step and try again.") };
  }
}

/** Owner sets call retention days (Compliance fields stay admin-only). */
export async function setCallRetentionAction(input: { days: number }) {
  const session = await requireUser();
  try {
    const actor = ownerActor(session);
    await setCallRetention(actor, { clientId: actor.clientId, days: input.days });
    revalidatePath("/home/business");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not update retention.") };
  }
}
