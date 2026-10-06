import { AccessLogTable } from "@/components/access-log-table";
import { PageHeader } from "@/components/ui";
import { accessQuery, parseAccessFilters } from "@/lib/access-view";
import { requireAdmin } from "@/lib/session";
import { accessLogs, clients } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClientAccessHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const filters = { ...parseAccessFilters(await searchParams), clientId: client.id };
  const page = await accessLogs({ role: "admin", clientId: client.id }).list({
    actor: filters.actor,
    action: filters.action,
    from: filters.from,
    to: filters.to,
    page: filters.page,
  });
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${client.id}`}>
        Back to {client.name}
      </Link>
      <PageHeader title="Access history" description={`Who opened ${client.name}'s transcripts, recordings, messages, and documents.`} />
      <AccessLogTable
        page={page}
        filters={filters}
        basePath={`/admin/clients/${client.id}/access`}
        admin
        timezone={client.timezone}
        exportHref={`/admin/access/export${accessQuery({ ...filters, page: 1 })}`}
      />
    </main>
  );
}
