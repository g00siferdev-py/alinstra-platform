import { clients } from "@alinstra/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

/** Unpaid self-serve owners may only use `/home` (Finish checkout). */
export async function redirectUnpaidSelfServeOwner(): Promise<void> {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) return;
  const client = await clients({ role: "client_owner", clientId: session.user.clientId }).getById(session.user.clientId);
  if (!client) return;
  if (client.selfServe && !client.paidAt && client.billingStatus !== "paid") {
    redirect("/home");
  }
}
