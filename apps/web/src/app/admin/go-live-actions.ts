"use server";

import {
  declineAutoGoLive,
  pauseClientByAdmin,
  resumeClientByAdmin,
  setAutoGoLive,
  type Actor,
} from "@alinstra/db";
import { enqueueApproveAutoGoLive } from "@alinstra/queue";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

export async function setAutoGoLiveAction(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    await setAutoGoLive(adminActor(session), enabled);
    revalidatePath("/admin/services");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the setting." };
  }
}

export async function approveGoLiveAction(clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    await enqueueApproveAutoGoLive({ clientId, actorId: session.user.id });
    revalidatePath(`/admin/clients/${clientId}`);
    revalidatePath("/admin/clients");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not approve go-live." };
  }
}

export async function declineGoLiveAction(clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    await declineAutoGoLive(adminActor(session), clientId);
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not decline." };
  }
}

export async function pauseAvaAction(clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    await pauseClientByAdmin(adminActor(session), clientId);
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not pause Ava." };
  }
}

export async function resumeAvaAction(clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    await resumeClientByAdmin(adminActor(session), clientId);
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not resume Ava." };
  }
}
