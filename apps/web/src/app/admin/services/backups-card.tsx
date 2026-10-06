import { Card, Pill } from "@/components/ui";
import { backupHealth, type BackupSnapshot } from "@alinstra/db";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(iso));
}

/** Last backup time, size and status. Red when the last success is more than 36 hours old (or never). */
export function BackupsCard({ snapshot, now = new Date() }: { snapshot: BackupSnapshot; now?: Date }) {
  const health = backupHealth(snapshot, now);
  const { last, lastSuccess } = snapshot;
  const red = health !== "ok";
  const headline = health === "never" ? "No successful backup yet" : health === "stale" ? "Overdue: last success is more than 36 hours old" : "Healthy";
  return (
    <div data-testid="backups-card" data-health={health}>
    <Card className={`grid gap-3 ${red ? "outline outline-2 outline-[var(--danger)]" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Backups</h2>
        <Pill tone={red ? "danger" : "success"}>{red ? (health === "never" ? "no backup" : "overdue") : "ok"}</Pill>
      </div>
      <p className="text-sm text-[var(--body)]">
        Encrypted nightly database dump to R2 at 03:30 Eastern, kept 30 days. Restore steps are in docs/RESTORE.md.
      </p>
      <p className={`text-sm font-semibold ${red ? "text-[var(--danger-text)]" : "text-[var(--ink)]"}`}>{headline}</p>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--muted)]">Last success</dt>
          <dd>{lastSuccess ? formatWhen(lastSuccess.at) : "never"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--muted)]">Size</dt>
          <dd>{lastSuccess ? formatBytes(lastSuccess.bytes) : "n/a"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--muted)]">Last attempt</dt>
          <dd>{last ? formatWhen(last.at) : "never"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--muted)]">Last attempt status</dt>
          <dd>
            {last ? (
              <Pill tone={last.status === "success" ? "success" : "danger"}>
                {last.status === "not_configured" ? "not configured" : last.status}
              </Pill>
            ) : (
              "n/a"
            )}
          </dd>
        </div>
      </dl>
      {last && last.status !== "success" && last.error ? (
        <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm">{last.error}</p>
      ) : null}
      {lastSuccess ? <p className="break-all text-xs text-[var(--muted)]">Latest object: {lastSuccess.key}</p> : null}
    </Card>
    </div>
  );
}
