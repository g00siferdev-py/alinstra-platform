"use server";

import { requireAdmin } from "@/lib/session";
import { saveInterviewSettings, type Actor } from "@alinstra/db";
import { revalidatePath } from "next/cache";

export type InterviewSettingsState = { ok?: boolean; error?: string } | null;

function adminActor(session: { user: { id: string } }): Actor {
  return { id: session.user.id, role: "admin" };
}

export async function saveInterviewSettingsAction(
  _prev: InterviewSettingsState,
  formData: FormData,
): Promise<InterviewSettingsState> {
  const session = await requireAdmin();
  try {
    const budgetIn = Number(formData.get("budgetInputTokens"));
    const budgetOut = Number(formData.get("budgetOutputTokens"));
    if (!Number.isFinite(budgetIn) || budgetIn < 1000 || !Number.isFinite(budgetOut) || budgetOut < 500) {
      return { error: "Token budgets must be positive numbers (input ≥ 1000, output ≥ 500)." };
    }
    await saveInterviewSettings(adminActor(session), {
      textApiBase: String(formData.get("textApiBase") ?? ""),
      textModel: String(formData.get("textModel") ?? ""),
      textFallbackModel: String(formData.get("textFallbackModel") ?? ""),
      budgetInputTokens: Math.round(budgetIn),
      budgetOutputTokens: Math.round(budgetOut),
      reasoningEffort: (() => {
        const raw = String(formData.get("reasoningEffort") ?? "default");
        return raw === "off" || raw === "low" || raw === "default" ? raw : "default";
      })(),
    });
    revalidatePath("/admin/interview");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save settings." };
  }
}
