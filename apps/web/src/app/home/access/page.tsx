import { AccessLogTable } from "@/components/access-log-table";
import { PageHeader } from "@/components/ui";
import { parseAccessFilters } from "@/lib/access-view";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import { accessLogs, clients } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * "Who viewed your calls": the access rows for the owner's own client. Staff and admins get a 404 (admins use
 * /admin/access); the repository pins the client, so nothing from another business can appear here.
 */
export default async function WhoViewedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();
  const ctx = { role: "client_owner" as const, clientId: session.user.clientId };
  const client = await clients(ctx).getById(ctx.clientId);
  if (!client) notFound();
  const filters = { ...parseAccessFilters(await searchParams), clientId: client.id };
  const page = await accessLogs(ctx).list({ action: filters.action, from: filters.from, to: filters.to, page: filters.page });
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Who viewed your calls"
        description={`Every time someone opens a call transcript, a recording, or your messages, it is recorded here. Your team shows by name; Alinstra staff show as "Alinstra support". Times are in ${client.timezone}. Entries are kept for 400 days.`}
      />
      <AccessLogTable page={page} filters={filters} basePath="/home/access" admin={false} timezone={client.timezone} />
    </main>
  );
}
