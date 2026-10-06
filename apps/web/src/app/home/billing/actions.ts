"use server";

import { getEnv } from "@alinstra/config";
import {
  cancelPlanChangeRequest,
  createOwnerPortalSession,
  requestPlanChange,
  type Actor,
} from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function ownerActor(session: { user: { id: string; role: string; clientId?: string | null } }): Actor & { clientId: string } {
  if (session.user.role !== "client_owner" || !session.user.clientId) {
    throw new Error("Only the client owner can manage billing.");
  }
  return { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function openCustomerPortalAction() {
  const session = await requireUser();
  try {
    const env = getEnv();
    const actor = ownerActor(session);
    const returnUrl = `${env.APP_URL.replace(/\/$/, "")}/home/billing`;
    const { url } = await createOwnerPortalSession(actor, platformsFor(env).billing, returnUrl);
    redirect(url);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { error: message(error, "Could not open the billing portal.") };
  }
}

export async function requestPlanChangeAction(toPlanId: string) {
  const session = await requireUser();
  try {
    await requestPlanChange(ownerActor(session), toPlanId);
    revalidatePath("/home/billing");
    return { ok: true as const };
  } catch (error) {
    return { error: message(error, "Could not request that plan change.") };
  }
}

export async function cancelPlanChangeAction(id: string) {
  const session = await requireUser();
  try {
    await cancelPlanChangeRequest(ownerActor(session), id);
    revalidatePath("/home/billing");
    return { ok: true as const };
  } catch (error) {
    return { error: message(error, "Could not cancel that request.") };
  }
}
