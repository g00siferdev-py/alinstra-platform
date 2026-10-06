"use server";

import { getEnv } from "@alinstra/config";
import { approvePlanChangeRequest, rejectPlanChangeRequest } from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function approvePlanChangeAction(id: string) {
  const session = await requireAdmin();
  try {
    const result = await approvePlanChangeRequest(
      { id: session.user.id, role: "admin" },
      id,
      platformsFor(getEnv()).billing,
    );
    revalidatePath(`/admin/clients`);
    return { ok: true as const, status: result.status };
  } catch (error) {
    return { error: message(error, "Could not approve that plan change.") };
  }
}

export async function rejectPlanChangeAction(id: string) {
  const session = await requireAdmin();
  try {
    await rejectPlanChangeRequest({ id: session.user.id, role: "admin" }, id);
    revalidatePath(`/admin/clients`);
    return { ok: true as const };
  } catch (error) {
    return { error: message(error, "Could not reject that plan change.") };
  }
}
