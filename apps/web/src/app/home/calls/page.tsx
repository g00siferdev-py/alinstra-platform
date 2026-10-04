import { CallsList } from "@/components/calls-list";
import { parseCallFilters } from "@/lib/call-view";
import { callViewerFor } from "@/lib/call-viewer";
import { requireUser } from "@/lib/session";
import { canSeeCallerNumber, canViewClientCalls, clients, listCalls } from "@alinstra/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PortalCallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireUser();
  const viewer = callViewerFor(session.user);
  // Staff without the grant (and admins, who use the admin screens) get a 404, not a 403.
  if (!viewer || viewer.role === "admin" || !viewer.clientId || !canViewClientCalls(viewer, viewer.clientId)) notFound();
  const client = await clients({ role: viewer.role, clientId: viewer.clientId }).getById(viewer.clientId);
  if (!client) notFound();
  const filters = parseCallFilters(await searchParams);
  const page = await listCalls(viewer, client.id, { from: filters.from, to: filters.to, outcome: filters.outcome, cursor: filters.cursor });
  return (
    <main className="mx-auto grid max-w-4xl gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Calls</h1>
        <p className="text-sm text-[var(--muted)]">
          Times in {client.timezone}. Transcripts, recordings, and caller numbers are kept {client.callRetentionDays} days, then purged.
        </p>
      </header>
      <CallsList rows={page.rows} nextCursor={page.nextCursor} filters={filters} basePath="/home/calls" timezone={client.timezone} fullNumbers={canSeeCallerNumber(viewer)} />
    </main>
  );
}
