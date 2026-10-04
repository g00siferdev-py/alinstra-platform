"use server";

import { markLeadContacted, type Actor } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

export async function markLeadContactedAction(id: string) {
  const session = await requireAdmin();
  try {
    await markLeadContacted(adminActor(session), id);
    revalidatePath("/admin/leads");
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update that lead." };
  }
}
