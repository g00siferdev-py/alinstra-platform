import { AccessLogTable } from "@/components/access-log-table";
import { PageHeader } from "@/components/ui";
import { accessQuery, parseAccessFilters } from "@/lib/access-view";
import { requireAdmin } from "@/lib/session";
import { accessLogs, clients, DEFAULT_TIMEZONE } from "@alinstra/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Same gate as Services: signed in, admin, and two-factor enrolled (otherwise redirected to enrol).
  await requireAdmin();
  const filters = parseAccessFilters(await searchParams);
  const ctx = { role: "admin" as const };
  const [page, clientRows] = await Promise.all([
    accessLogs(ctx).list({ clientId: filters.clientId, actor: filters.actor, action: filters.action, from: filters.from, to: filters.to, page: filters.page }),
    clients(ctx).list(),
  ]);
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Access log"
        description="Who opened call transcripts, recordings, messages, and documents. Times are Eastern. Rows older than 400 days are removed each night."
      />
      <AccessLogTable
        page={page}
        filters={filters}
        basePath="/admin/access"
        admin
        timezone={DEFAULT_TIMEZONE}
        clients={clientRows.map((client) => ({ id: client.id, name: client.name }))}
        exportHref={`/admin/access/export${accessQuery({ ...filters, page: 1 })}`}
      />
    </main>
  );
}
