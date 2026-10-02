"use server";

import { getEnv, log } from "@alinstra/config";
import {
  createClientZero,
  endServiceNow,
  replaceTransferTargets,
  scheduleChurn,
  startProvisioning,
  syncProvisionedAgent,
  type Actor,
} from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { enqueueProvisionClient, enqueueSendAdminNotice, enqueueSyncAgent } from "@alinstra/queue";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

function deps() {
  const env = getEnv();
  return {
    ...platformsFor(env),
    appUrl: env.APP_URL,
    voiceId: env.RETELL_DEFAULT_VOICE_ID,
    danielNumber: env.DANIEL_TRANSFER_NUMBER || null,
    danielEmail: env.ADMIN_EMAIL,
  };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function startProvisioningAction(clientId: string) {
  const session = await requireAdmin();
  try {
    await startProvisioning(adminActor(session), clientId);
    await enqueueProvisionClient({ clientId });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not start provisioning.") };
  }
}

export async function retrySyncAction(clientId: string) {
  await requireAdmin();
  try {
    const result = await syncProvisionedAgent(clientId, deps());
    if (result === "failed") {
      await enqueueSendAdminNotice({
        subject: "Retell sync failed",
        text: `The receptionist for client ${clientId} is out of date. Open the client and retry the sync.`,
      }).catch(() => undefined);
    }
    revalidatePath(`/admin/clients/${clientId}`);
    return result === "failed" ? { error: "Sync failed — retry" } : { ok: true };
  } catch (error) {
    log("error", "agent sync failed", { error: error instanceof Error ? error.name : "unknown" });
    return { error: message(error, "Sync failed — retry") };
  }
}

export async function scheduleChurnAction(clientId: string) {
  const session = await requireAdmin();
  try {
    await scheduleChurn(adminActor(session), clientId, deps());
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not schedule the end of service.") };
  }
}

export async function endServiceNowAction(clientId: string) {
  const session = await requireAdmin();
  try {
    await endServiceNow(adminActor(session), clientId, deps());
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not end service.") };
  }
}

export async function saveTransferTargetsAction(clientId: string, text: string) {
  const session = await requireAdmin();
  try {
    const saved = await replaceTransferTargets(adminActor(session), { clientId, text });
    if (saved.sync) await enqueueSyncAgent({ clientId }).catch(() => undefined);
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Could not save transfer targets.") };
  }
}

export async function createClientZeroAction() {
  const session = await requireAdmin();
  try {
    const created = await createClientZero(adminActor(session));
    revalidatePath("/admin/clients");
    return { id: created.id };
  } catch (error) {
    return { error: message(error, "Could not create client zero.") };
  }
}
