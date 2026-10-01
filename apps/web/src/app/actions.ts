"use server";

import { acceptInvite, AuthError, createInvite } from "@alinstra/auth";
import { clients, createClient } from "@alinstra/db";
import { requireAdmin, requireUser } from "@/lib/session";

export type ActionState = { error?: string; ok?: boolean; email?: string } | null;

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a client name." };
  await createClient({ role: "admin", clientId: session.user.clientId ?? undefined }, name);
  return { ok: true };
}

export async function inviteOwnerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdmin();
  try {
    await createInvite({
      actor: { id: session.user.id, role: "admin" },
      email: String(formData.get("email") ?? ""),
      role: "client_owner",
      clientId: String(formData.get("clientId") ?? ""),
    });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Could not send the invite." };
  }
}

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) {
    return { error: "Only a client owner can invite staff." };
  }
  try {
    await createInvite({
      actor: { id: session.user.id, role: "client_owner", clientId: session.user.clientId },
      email: String(formData.get("email") ?? ""),
      role: "client_staff",
      clientId: session.user.clientId,
    });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Could not send the invite." };
  }
}

export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await acceptInvite({
      token: String(formData.get("token") ?? ""),
      name: String(formData.get("name") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    return { ok: true, email: user.email };
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Could not accept the invite." };
  }
}

export async function listClientsForAdmin() {
  await requireAdmin();
  return clients({ role: "admin" }).list();
}
