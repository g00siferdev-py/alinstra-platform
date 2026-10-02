"use server";

import {
  activateAgentConfig,
  approveChangeRequest,
  approveQuickUpdate,
  previewChangeRequest,
  previewHeldUpdate,
  rejectChangeRequest,
  rejectQuickUpdate,
  rollbackAgentConfig,
  type Actor,
} from "@alinstra/db";
import { enqueueSyncAgent } from "@alinstra/queue";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function activateAgentAction(clientId: string, version: number) {
  const session = await requireAdmin();
  try {
    await activateAgentConfig(adminActor(session), { clientId, version });
    await enqueueSyncAgent({ clientId }).catch(() => undefined);
    revalidatePath(`/admin/clients/${clientId}/agent`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not activate that version.") };
  }
}

export async function rollbackAgentAction(clientId: string, version: number) {
  const session = await requireAdmin();
  try {
    await rollbackAgentConfig(adminActor(session), { clientId, version });
    await enqueueSyncAgent({ clientId }).catch(() => undefined);
    revalidatePath(`/admin/clients/${clientId}/agent`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not roll back to that version.") };
  }
}

export async function previewHeldUpdateAction(id: string) {
  const session = await requireAdmin();
  try {
    const result = await previewHeldUpdate(adminActor(session), id);
    return { prompt: result.prompt, truncated: result.truncated, holdReason: result.holdReason };
  } catch (error) {
    return { error: message(error, "Could not preview that update.") };
  }
}

export async function approveQuickUpdateAction(id: string) {
  const session = await requireAdmin();
  try {
    const approved = await approveQuickUpdate(adminActor(session), id);
    await enqueueSyncAgent({ clientId: approved.clientId }).catch(() => undefined);
    revalidatePath("/home");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not approve that update.") };
  }
}

export async function rejectQuickUpdateAction(id: string) {
  const session = await requireAdmin();
  try {
    await rejectQuickUpdate(adminActor(session), id);
    revalidatePath("/home");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not reject that update.") };
  }
}

export async function previewChangeRequestAction(input: { id: string; fields: unknown }) {
  const session = await requireAdmin();
  try {
    const result = await previewChangeRequest(adminActor(session), input);
    return { prompt: result.prompt, truncated: result.truncated, lines: result.lines, fields: result.fields };
  } catch (error) {
    return { error: message(error, "Could not preview that request.") };
  }
}

export async function approveChangeRequestAction(input: { id: string; fields: unknown }) {
  const session = await requireAdmin();
  try {
    const approved = await approveChangeRequest(adminActor(session), input);
    await enqueueSyncAgent({ clientId: approved.clientId }).catch(() => undefined);
    revalidatePath("/home");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not approve that request.") };
  }
}

export async function rejectChangeRequestAction(id: string) {
  const session = await requireAdmin();
  try {
    await rejectChangeRequest(adminActor(session), id);
    revalidatePath("/home");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not reject that request.") };
  }
}
