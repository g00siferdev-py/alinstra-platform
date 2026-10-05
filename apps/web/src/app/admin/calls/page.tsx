import { adminOverview, listLiveCalls, type Actor } from "@alinstra/db";
import { Button, Card, EmptyState, PageHeader, Pill, SectionCard } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTime(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function AdminCallsPage() {
  const session = await requireAdmin();
  const actor: Actor = { id: session.user.id, role: "admin" };
  const [overview, live] = await Promise.all([adminOverview(actor), listLiveCalls(actor)]);

  return (
    <main className="grid gap-6">
      <PageHeader title="Calls" description="Live and recent calls across every client." />
      {live.length > 0 ? (
        <Card className="grid gap-3 border border-[var(--live-border)] bg-[var(--live-soft)]">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--live-text)]">LIVE NOW</p>
          {live.map((call) => (
            <div key={call.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-extrabold text-[var(--ink)]">{call.clientName}</p>
                <p className="text-sm text-[var(--live-text)]">
                  {call.statusLine} · {call.callerMasked}
                </p>
              </div>
              <Link href={`/admin/clients/${call.clientId}/calls/${call.id}`}>
                <Button variant="secondary">View call</Button>
              </Link>
            </div>
          ))}
        </Card>
      ) : null}
      <SectionCard
        title="Latest calls"
        action={
          <Link className="text-sm font-bold no-underline" href="/admin/clients">
            See clients
          </Link>
        }
      >
        {overview.latestCalls.length === 0 ? (
          <EmptyState title="No calls yet" description="When Ava answers, they show up here." />
        ) : (
          overview.latestCalls.map((call) => (
            <Link
              key={call.id}
              href={`/admin/clients/${call.clientId}/calls/${call.id}`}
              className="grid grid-cols-[5rem_minmax(0,1fr)_auto_4rem] items-center gap-3 px-5 py-3 text-sm text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]"
            >
              <span className="text-[var(--muted)]">{formatTime(call.startedAt)}</span>
              <span className="truncate font-semibold">{call.summarySnippet}</span>
              <Pill tone={call.flagged ? "warning" : "neutral"}>
                {call.outcome?.replaceAll("_", " ") ?? "No action"}
              </Pill>
              <span className="text-right tabular-nums text-[var(--muted)]">{formatDuration(call.durationSeconds)}</span>
            </Link>
          ))
        )}
      </SectionCard>
    </main>
  );
}
