import { CallDetail } from "@/components/call-detail";
import { requireAdmin } from "@/lib/session";
import { clients, getCall } from "@alinstra/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminCallDetailPage({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const session = await requireAdmin();
  const { id, callId } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const call = await getCall({ id: session.user.id, role: "admin" }, callId);
  if (!call || call.clientId !== client.id) notFound();
  const voice = client.voice && typeof client.voice === "object" ? (client.voice as { assistantName?: unknown }) : {};
  const assistantName = typeof voice.assistantName === "string" && voice.assistantName.trim() ? voice.assistantName.trim() : "Ava";
  return (
    <CallDetail
      call={call}
      timezone={client.timezone}
      assistantName={assistantName}
      retentionDays={client.callRetentionDays}
      fullNumbers
      admin
      messageHref={call.message ? `/admin/clients/${client.id}#messages` : null}
      backHref={`/admin/clients/${client.id}/calls`}
    />
  );
}
