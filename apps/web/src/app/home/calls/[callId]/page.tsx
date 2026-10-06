import { CallDetail } from "@/components/call-detail";
import { logCallDetailView } from "@/lib/access-log";
import { callViewerFor } from "@/lib/call-viewer";
import { requireUser } from "@/lib/session";
import { canSeeCallerNumber, clients, getCall } from "@alinstra/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PortalCallDetailPage({ params }: { params: Promise<{ callId: string }> }) {
  const session = await requireUser();
  const viewer = callViewerFor(session.user);
  if (!viewer || viewer.role === "admin" || !viewer.clientId) notFound();
  const { callId } = await params;
  // getCall applies canAccessCall; anything the viewer may not see is simply missing.
  const call = await getCall(viewer, callId);
  if (!call) notFound();
  const client = await clients({ role: viewer.role, clientId: viewer.clientId }).getById(call.clientId);
  if (!client) notFound();
  await logCallDetailView(session.user, call);
  const voice = client.voice && typeof client.voice === "object" ? (client.voice as { assistantName?: unknown }) : {};
  const assistantName = typeof voice.assistantName === "string" && voice.assistantName.trim() ? voice.assistantName.trim() : "Ava";
  return (
    <CallDetail
      call={call}
      timezone={client.timezone}
      assistantName={assistantName}
      retentionDays={client.callRetentionDays}
      fullNumbers={canSeeCallerNumber(viewer)}
      admin={false}
      businessName={client.name}
      messageHref={call.message ? "/home#messages" : null}
      backHref="/home/calls"
    />
  );
}
