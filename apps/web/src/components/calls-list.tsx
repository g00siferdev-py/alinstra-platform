import { Button, Card, EmptyState, Input, Label, Pill, Select } from "@/components/ui";
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
  return <Pill tone="neutral">{outcomeLabel(outcome)}</Pill>;
}

export function SentimentLabel({ sentiment }: { sentiment: string | null }) {
  const view = sentimentDisplay(sentiment);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span aria-hidden="true" className="inline-block w-3 text-center font-mono">
        {view.icon}
      </span>
      {view.label}
    </span>
  );
}

export function CallsList({ rows, nextCursor, filters, basePath, timezone, fullNumbers }: Props) {
  const filtered = Boolean(filters.fromText || filters.toText || filters.outcome);
  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get" action={basePath}>
          <label className="grid gap-1">
            <Label>From</Label>
            <Input type="date" name="from" defaultValue={filters.fromText} />
          </label>
          <label className="grid gap-1">
            <Label>To</Label>
            <Input type="date" name="to" defaultValue={filters.toText} />
          </label>
          <label className="grid gap-1">
            <Label>Outcome</Label>
            <Select name="outcome" defaultValue={filters.outcome ?? ""}>
              <option value="">Any</option>
              {OUTCOME_OPTIONS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {filtered ? (
            <Link className="text-sm font-bold" href={basePath}>
              Clear
            </Link>
          ) : null}
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={filtered ? "No calls match these filters." : "No calls yet"}
            description={filtered ? undefined : "Calls appear here a minute or two after they end."}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-[var(--divider)]">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`${basePath}/${row.id}`}
                className="grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3 text-sm text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]"
              >
                <span className="truncate font-semibold">
                  {row.startedAt ? formatLocalTime(row.startedAt, timezone) : "—"}
                </span>
                <span className="tabular-nums text-[var(--muted)]">{formatDuration(row.durationSeconds)}</span>
                <span className="truncate">{fullNumbers ? formatPhone(row.caller) || row.caller : row.caller}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <OutcomeBadge outcome={row.outcome} />
                  {row.flagged ? <Pill tone="warning">Flagged</Pill> : null}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {row.purgedAt ? "purged" : row.hasRecording ? "recording" : null}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {nextCursor ? (
        <div className="text-sm">
          <Link className="font-bold" href={`${basePath}${filterQuery(filters, nextCursor)}`}>
            Older calls
          </Link>
        </div>
      ) : null}
    </div>
  );
}
