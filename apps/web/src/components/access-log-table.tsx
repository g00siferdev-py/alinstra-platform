import { Button, Card, EmptyState, Input, Label, Pill, Select } from "@/components/ui";
import { ACCESS_ACTION_OPTIONS, accessQuery, type AccessFilters } from "@/lib/access-view";
import { accessActionLabel, type AccessLogPage } from "@alinstra/db";
import Link from "next/link";

type ClientOption = { id: string; name: string };

type Props = {
  page: AccessLogPage;
  filters: AccessFilters;
  /** Path of the page showing the table; filter and paging links stay on it. */
  basePath: string;
  /** Admin view: IP and browser columns, and the actor filter. */
  admin: boolean;
  timezone: string;
  /** Present on the global admin page: a client column and filter. Absent when scoped to one client. */
  clients?: ClientOption[];
  /** Full CSV download link including the current filters (admin only). */
  exportHref?: string;
};

export function formatAccessTime(value: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(value);
  } catch {
    return value.toISOString();
  }
}

function browserOf(userAgent: string | null): string {
  if (!userAgent) return "â€”";
  const match = /(Edg|Chrome|Firefox|Safari|OPR)\/[\d.]+/.exec(userAgent);
  const os = /Windows|Mac OS X|Android|iPhone|iPad|Linux/.exec(userAgent)?.[0];
  const name = match ? (match[1] === "Edg" ? "Edge" : match[1] === "OPR" ? "Opera" : match[1]) : "Browser";
  return os ? `${name} on ${os}` : (name ?? "Browser");
}

function rolePill(role: string) {
  if (role === "admin") return <Pill tone="purple">Admin</Pill>;
  if (role === "client_owner") return <Pill tone="info">Owner</Pill>;
  return <Pill tone="neutral">Staff</Pill>;
}

export function AccessLogFilters({ filters, basePath, clients, exportHref, admin }: Pick<Props, "filters" | "basePath" | "clients" | "exportHref" | "admin">) {
  const filtered = Boolean(filters.clientId || filters.actor || filters.action || filters.fromText || filters.toText);
  return (
    <Card className="flex flex-wrap items-end gap-3">
      <form className="flex flex-wrap items-end gap-3 text-sm" method="get" action={basePath}>
        {clients ? (
          <label className="grid gap-1">
            <Label>Client</Label>
            <Select name="client" defaultValue={filters.clientId}>
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {admin ? (
          <label className="grid gap-1">
            <Label>Actor (email or id)</Label>
            <Input type="text" name="actor" defaultValue={filters.actor} placeholder="dana@example.com" maxLength={120} />
          </label>
        ) : null}
        <label className="grid gap-1">
          <Label>Action</Label>
          <Select name="action" defaultValue={filters.action ?? ""}>
            <option value="">Any</option>
            {ACCESS_ACTION_OPTIONS.map((action) => (
              <option key={action} value={action}>
                {accessActionLabel(action)}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <Label>From</Label>
          <Input type="date" name="from" defaultValue={filters.fromText} />
        </label>
        <label className="grid gap-1">
          <Label>To</Label>
          <Input type="date" name="to" defaultValue={filters.toText} />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {filtered ? (
          <Link className="text-sm font-bold" href={basePath}>
            Clear
          </Link>
        ) : null}
        {exportHref ? (
          <a className="text-sm font-bold" href={exportHref}>
            Export CSV
          </a>
        ) : null}
      </form>
    </Card>
  );
}

export function AccessLogTable({ page, filters, basePath, admin, timezone, clients, exportHref }: Props) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const showClient = Boolean(clients);
  const omit: Array<"client"> = showClient ? [] : ["client"];
  return (
    <div className="grid gap-4">
      <AccessLogFilters filters={filters} basePath={basePath} clients={clients} exportHref={exportHref} admin={admin} />
      {page.rows.length === 0 ? (
        <Card>
          <EmptyState title="Nothing matches." description="Reads of transcripts, recordings, messages, and documents appear here." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--divider)] text-[13px] text-[var(--muted)]">
                  <th className="px-5 py-3 font-semibold">When</th>
                  <th className="px-3 py-3 font-semibold">Who</th>
                  <th className="px-3 py-3 font-semibold">What</th>
                  {showClient ? <th className="px-3 py-3 font-semibold">Client</th> : null}
                  <th className="px-3 py-3 font-semibold">Items</th>
                  {admin ? <th className="px-3 py-3 font-semibold">Network</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--divider)]">
                {page.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-[var(--muted)]">{formatAccessTime(row.at, timezone)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--ink)]">{row.actorLabel}</span>
                        {admin ? rolePill(row.actorRole) : null}
                        {row.impersonating ? <Pill tone="warning">Viewing as client</Pill> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{row.actionLabel}</div>
                      {admin ? (
                        <code className="text-xs text-[var(--muted)]">
                          {row.action} Â· {row.entityType}:{row.entityId}
                        </code>
                      ) : null}
                    </td>
                    {showClient ? (
                      <td className="px-3 py-3">
                        <Link href={`/admin/clients/${row.clientId}`}>{row.clientName}</Link>
                      </td>
                    ) : null}
                    <td className="px-3 py-3 tabular-nums">{row.count ?? "â€”"}</td>
                    {admin ? (
                      <td className="px-3 py-3 text-xs text-[var(--muted)]">
                        <div>{row.ip ?? "â€”"}</div>
                        <div>{browserOf(row.userAgent)}</div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-[var(--muted)]">
          {page.total} {page.total === 1 ? "entry" : "entries"} Â· page {Math.min(page.page, pages)} of {pages}
        </span>
        <span className="flex gap-4 font-bold">
          {page.page > 1 ? <Link href={`${basePath}${accessQuery(filters, { page: page.page - 1, omit })}`}>Newer</Link> : null}
          {page.page < pages ? <Link href={`${basePath}${accessQuery(filters, { page: page.page + 1, omit })}`}>Older</Link> : null}
        </span>
      </div>
    </div>
  );
}
