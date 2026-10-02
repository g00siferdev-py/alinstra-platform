"use server";

import { AuthError, createInvite } from "@alinstra/auth";
import { log } from "@alinstra/config";
import {
  clients,
  continueWizard,
  discardWizard,
  removeClient,
  saveWizardDraft,
  previewWizardPrompt,
  startWizard,
  submitWizard,
  updatePlan,
  type Actor,
} from "@alinstra/db";
import { getStorage } from "@alinstra/storage";
import { requireAdmin } from "@/lib/session";
import { redirect } from "next/navigation";

function rethrowRedirect(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  ) {
    throw error;
  }
}

export type ActionState = { error?: string; ok?: boolean; updatedAt?: string } | null;

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

export async function startWizardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const client = await startWizard(adminActor(session), String(formData.get("name") ?? ""));
    redirect(`/admin/clients/${client.id}/wizard`);
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "Could not start the wizard." };
  }
}

export async function saveDraftAction(input: {
  clientId: string;
  payload: unknown;
  currentStep: number;
  updatedAt: string;
}): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const draft = await saveWizardDraft(adminActor(session), input);
    return { ok: true, updatedAt: draft.updatedAt.toISOString() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the draft." };
  }
}

export async function continueWizardAction(input: {
  clientId: string;
  step: number;
  payload: unknown;
  updatedAt: string;
}): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const draft = await continueWizard(adminActor(session), input);
    return { ok: true, updatedAt: draft.updatedAt.toISOString() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Check this step and try again." };
  }
}

export async function submitWizardAction(input: {
  clientId: string;
  payload: unknown;
  updatedAt: string;
}): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    await submitWizard(adminActor(session), input);
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "Could not submit the wizard." };
  }
  redirect(`/admin/clients/${input.clientId}`);
}

export async function discardWizardAction(clientId: string): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const keys = await discardWizard(adminActor(session), clientId);
    const storage = getStorage();
    for (const key of keys) {
      await storage.delete(key).catch((error: unknown) => {
        log("error", "discarded draft object delete failed", {
          clientId,
          message: error instanceof Error ? error.message : "delete failed",
        });
      });
    }
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "Could not discard the draft." };
  }
  redirect("/admin/clients");
}

export async function removeClientAction(clientId: string): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const keys = await removeClient(adminActor(session), clientId);
    const storage = getStorage();
    for (const key of keys) {
      await storage.delete(key).catch((error: unknown) => {
        log("error", "removed client object delete failed", {
          clientId,
          message: error instanceof Error ? error.message : "delete failed",
        });
      });
    }
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "Could not remove the client." };
  }
  redirect("/admin/clients");
}

export async function sendPortalInviteAction(clientId: string): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    const client = await clients({ role: "admin" }).getById(clientId);
    const email = client?.portalOwnerEmail?.trim();
    if (!email) return { error: "This client has no owner email on file." };
    await createInvite({
      actor: { id: session.user.id, role: "admin" },
      email,
      role: "client_owner",
      clientId,
    });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Could not send the invite." };
  }
}

export async function previewWizardPromptAction(input: { clientId: string; payload: unknown }) {
  const session = await requireAdmin();
  try {
    const result = await previewWizardPrompt(adminActor(session), input);
    return { prompt: result.prompt, truncated: result.truncated };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not preview the prompt." };
  }
}

export async function updatePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdmin();
  const cents = (name: string) => Math.round(Number(formData.get(name)) * 100);
  const changes = String(formData.get("includedChanges") ?? "").trim();
  try {
    await updatePlan(adminActor(session), String(formData.get("planId") ?? ""), {
      monthlyPriceCents: cents("monthly"),
      includedMinutes: Number(formData.get("minutes")),
      overagePerMinuteCents: cents("overage"),
      setupFeeCents: cents("setup"),
      includedChangesPerMonth: changes === "" ? null : Number(changes),
      extraChangeFeeCents: cents("extraChange"),
    });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the plan." };
  }
}

