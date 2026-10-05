import { CallsList } from "@/components/calls-list";
import { PageHeader } from "@/components/ui";
import { parseCallFilters } from "@/lib/call-view";
import { requireAdmin } from "@/lib/session";
import { clients, listCalls } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminClientCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const filters = parseCallFilters(await searchParams);
  const page = await listCalls({ id: session.user.id, role: "admin" }, client.id, { from: filters.from, to: filters.to, outcome: filters.outcome, cursor: filters.cursor });
  const basePath = `/admin/clients/${client.id}/calls`;
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${client.id}`}>
        {client.name}
      </Link>
      <PageHeader
        title="Calls"
        description={`Times in ${client.timezone}. Transcripts, recordings, and caller numbers are kept ${client.callRetentionDays} days.`}
      />
      <CallsList rows={page.rows} nextCursor={page.nextCursor} filters={filters} basePath={basePath} timezone={client.timezone} fullNumbers />
    </main>
  );
}
