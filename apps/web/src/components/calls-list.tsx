import { filterQuery, formatDuration, OUTCOME_OPTIONS, outcomeLabel, sentimentDisplay, type CallFilters } from "@/lib/call-view";
import { formatLocalTime, formatPhone, type CallSummaryRow } from "@alinstra/db";
import Link from "next/link";

type Props = {
  rows: CallSummaryRow[];
  nextCursor: string | null;
  filters: CallFilters;
  /** Path of the list page; detail links are `${basePath}/${id}`. */
  basePath: string;
  timezone: string;
  /** Whether rows carry a full number (owner/admin) or a mask (staff). Only affects formatting. */
  fullNumbers: boolean;
};

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  return <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">{outcomeLabel(outcome)}</span>;
}

export function SentimentLabel({ sentiment }: { sentiment: string | null }) {
  const view = sentimentDisplay(sentiment);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span aria-hidden="true" className="inline-block w-3 text-center font-mono">{view.icon}</span>
      {view.label}
    </span>
  );
}

export function CallsList({ rows, nextCursor, filters, basePath, timezone, fullNumbers }: Props) {
  const filtered = Boolean(filters.fromText || filters.toText || filters.outcome);
  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap items-end gap-3 text-sm" method="get" action={basePath}>
        <label className="grid gap-1">
          <span className="text-xs text-[var(--muted)]">From</span>
          <input className="rounded-md border border-[var(--line)] px-2 py-1" type="date" name="from" defaultValue={filters.fromText} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-[var(--muted)]">To</span>
          <input className="rounded-md border border-[var(--line)] px-2 py-1" type="date" name="to" defaultValue={filters.toText} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-[var(--muted)]">Outcome</span>
          <select className="rounded-md border border-[var(--line)] px-2 py-1" name="outcome" defaultValue={filters.outcome ?? ""}>
            <option value="">Any</option>
            {OUTCOME_OPTIONS.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-1">Filter</button>
        {filtered ? <Link className="text-xs" href={basePath}>Clear</Link> : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
          {filtered ? "No calls match these filters." : "No calls yet. Calls appear here a minute or two after they end."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="py-1 pr-3 font-normal">When</th>
                <th className="py-1 pr-3 font-normal">Duration</th>
                <th className="py-1 pr-3 font-normal">Caller</th>
                <th className="py-1 pr-3 font-normal">Outcome</th>
                <th className="py-1 pr-3 font-normal">Sentiment</th>
                <th className="py-1 font-normal"><span className="sr-only">Recording</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Link href={`${basePath}/${row.id}`}>{row.startedAt ? formatLocalTime(row.startedAt, timezone) : "—"}</Link>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatDuration(row.durationSeconds)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fullNumbers ? formatPhone(row.caller) || row.caller : row.caller}</td>
                  <td className="py-2 pr-3"><OutcomeBadge outcome={row.outcome} /></td>
                  <td className="py-2 pr-3"><SentimentLabel sentiment={row.sentiment} /></td>
                  <td className="py-2 text-xs text-[var(--muted)]">
                    {row.purgedAt ? "purged" : row.hasRecording ? <span className="rounded-full border border-[var(--line)] px-2 py-0.5">recording</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <div className="text-sm">
          <Link href={`${basePath}${filterQuery(filters, nextCursor)}`}>Older calls</Link>
        </div>
      ) : null}
    </div>
  );
}
