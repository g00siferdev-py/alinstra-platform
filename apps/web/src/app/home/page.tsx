import {
  adminOverview,
  callLinksFor,
  clientMessages,
  clients,
  formatLocalTime,
  plans,
  type Actor,
  type TenantContext,
} from "@alinstra/db";
import { LiveCallBanner } from "@/components/live-call-banner";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pill,
  ProgressBar,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { callViewerFor } from "@/lib/call-viewer";
import { requireUser } from "@/lib/session";
import { ClipboardList, Clock3, MessageSquare, Phone } from "lucide-react";
import Link from "next/link";

function firstName(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "there";
  return source.split(/\s+/)[0] ?? "there";
}

function formatDateLine(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

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

function statusPillTone(status: string): "live" | "warning" | "neutral" | "success" {
  if (status === "on_a_call") return "live";
  if (status === "setting_up") return "warning";
  if (status === "live") return "success";
  return "neutral";
}

export default async function HomePage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";
  const needsTwoFactor = isAdmin && !session.user.twoFactorEnabled;
  const role = session.user.role;
  const clientId = session.user.clientId;
  const now = new Date();
  const greetingName = firstName(session.user.name, session.user.email);

  if (isAdmin && !needsTwoFactor) {
    const actor: Actor = { id: session.user.id, role: "admin" };
    const overview = await adminOverview(actor, now);
    return (
      <main className="grid gap-6">
        <PageHeader
          eyebrow={formatDateLine(now)}
          title={`Hi ${greetingName}, here's today`}
          actions={
            <>
              <Link href={overview.startInterviewHref}>
                <Button variant="secondary">Start interview</Button>
              </Link>
              <Link href="/admin/clients/new">
                <Button variant="primary">New client</Button>
              </Link>
            </>
          }
        />

        <LiveCallBanner />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Phone className="h-5 w-5 text-[var(--primary)]" />}
            value={overview.stats.callsToday}
            label="Calls today"
          />
          <StatCard
            icon={<MessageSquare className="h-5 w-5 text-[var(--primary)]" />}
            value={overview.stats.messagesToday}
            label="Messages today"
          />
          <StatCard
            icon={<Clock3 className="h-5 w-5 text-[var(--primary)]" />}
            value={overview.stats.minutesThisMonth}
            label="Minutes this month"
          />
          <StatCard
            icon={<ClipboardList className="h-5 w-5 text-[var(--warning-text)]" />}
            value={overview.stats.todoCount}
            label="To-dos"
            soft="var(--warning-soft)"
            emphasize={overview.stats.todoCount > 0}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <SectionCard title="To-do">
            {overview.todos.length === 0 ? (
              <EmptyState title="You're caught up" description="Nothing needs a review right now." />
            ) : (
              overview.todos.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid gap-1 px-5 py-4 text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]"
                >
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-[var(--muted)]">{item.detail}</p>
                </Link>
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Clients"
            action={
              <Link className="text-sm font-bold no-underline" href="/admin/clients">
                See all
              </Link>
            }
          >
            {overview.clients.length === 0 ? (
              <EmptyState title="No clients yet" description="Add a client to get started." />
            ) : (
              overview.clients.map((client) => (
                <div
                  key={client.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] text-sm font-extrabold text-[var(--primary)]">
                    {client.initials}
                  </span>
                  <div className="min-w-0 grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/clients/${client.id}`} className="truncate font-bold no-underline">
                        {client.name}
                      </Link>
                      <Pill tone={statusPillTone(client.status)}>{client.statusLabel}</Pill>
                    </div>
                    <p className="text-sm text-[var(--muted)]">
                      {client.planName ?? "No plan"} · {client.minutesUsed}/{client.minutesIncluded} min
                    </p>
                    {client.minutesIncluded > 0 ? (
                      <ProgressBar value={client.minutesUsed} max={client.minutesIncluded} />
                    ) : null}
                  </div>
                  {client.continueHref ? (
                    <Link href={client.continueHref}>
                      <Button variant="small">Continue</Button>
                    </Link>
                  ) : (
                    <Link href={`/admin/clients/${client.id}`}>
                      <Button variant="small">Open</Button>
                    </Link>
                  )}
                </div>
              ))
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="Latest calls"
          action={
            <Link className="text-sm font-bold no-underline" href="/admin/calls">
              See all
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
                <span className="text-right tabular-nums text-[var(--muted)]">
                  {formatDuration(call.durationSeconds)}
                </span>
              </Link>
            ))
          )}
        </SectionCard>
      </main>
    );
  }

  let messages: Array<{ id: string; callerName: string; body: string; createdAt: Date; retellCallId: string | null }> =
    [];
  let callLinks = new Map<string, string>();
  let clientName: string | null = null;
  let clientTimezone = "America/New_York";
  let planName: string | null = null;
  let minutes = 0;
  if (clientId && (role === "client_owner" || role === "client_staff")) {
    const ctx: TenantContext = { role, clientId };
    const [client, messageRows] = await Promise.all([
      clients(ctx).getById(clientId),
      clientMessages(ctx).list(clientId),
    ]);
    messages = messageRows;
    const viewer = callViewerFor(session.user);
    if (viewer) callLinks = await callLinksFor(viewer, clientId, messageRows.map((row) => row.retellCallId));
    const plan = client?.planId ? await plans(ctx).getById(client.planId) : null;
    clientName = client?.name ?? null;
    clientTimezone = client?.timezone ?? clientTimezone;
    planName = plan?.name ?? null;
    minutes = client?.overrideIncludedMinutes ?? plan?.includedMinutes ?? 0;
  }

  return (
    <main className="grid gap-6">
      <PageHeader title={`Hi ${greetingName}`} description={formatDateLine(now)} />

      {needsTwoFactor ? (
        <Card className="grid gap-3">
          <h2 className="text-lg font-extrabold">Two-factor authentication is required</h2>
          <p className="text-sm text-[var(--muted)]">
            Admin tools stay unavailable until an authenticator app is enrolled.
          </p>
          <Link href="/account/security">
            <Button>Set up two-factor</Button>
          </Link>
        </Card>
      ) : null}

      {clientName ? (
        <Card className="grid gap-3">
          <h2 className="text-lg font-extrabold">{clientName}</h2>
          <p className="text-sm text-[var(--muted)]">{planName ?? "No plan yet"}</p>
          <p className="text-sm">Minutes included: {minutes}</p>
          <div className="text-sm" id="messages">
            <p className="font-bold">Messages</p>
            {messages.length === 0 ? <p className="text-[var(--muted)]">No messages yet.</p> : null}
            <ul className="grid gap-1">
              {messages.map((message) => {
                const callId = message.retellCallId ? callLinks.get(message.retellCallId) : undefined;
                return (
                  <li key={message.id}>
                    {formatLocalTime(message.createdAt, clientTimezone)} · {message.callerName}: {message.body}
                    {callId ? (
                      <>
                        {" "}
                        · <Link href={`/home/calls/${callId}`}>View call</Link>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/home/business">My business</Link>
            {session.user.role === "client_owner" || session.user.canViewCalls === true ? (
              <Link href="/home/calls">Calls</Link>
            ) : null}
            {session.user.role === "client_owner" ? <Link href="/home/changes">Change requests</Link> : null}
            {session.user.role === "client_owner" ? <Link href="/home/team">Team</Link> : null}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
