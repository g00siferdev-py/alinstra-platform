import {
  adminOverview,
  callLinksFor,
  clientMessages,
  formatLocalTime,
  listCalls,
  ownerOverview,
  type Actor,
  type TenantContext,
} from "@alinstra/db";
import { LiveCallBanner } from "@/components/live-call-banner";
import { ReopenCheckoutButton } from "@/components/reopen-checkout-button";
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
import { logMessageList } from "@/lib/access-log";
import { outcomeLabel } from "@/lib/call-view";
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
  if (status === "setting_up" || status === "paused") return "warning";
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

  if (needsTwoFactor) {
    return (
      <main className="grid gap-6">
        <PageHeader title={`Hi ${greetingName}`} description={formatDateLine(now)} />
        <Card className="grid gap-3">
          <h2 className="text-lg font-extrabold">Two-factor authentication is required</h2>
          <p className="text-sm text-[var(--muted)]">
            Admin tools stay unavailable until an authenticator app is enrolled.
          </p>
          <Link href="/account/security">
            <Button>Set up two-factor</Button>
          </Link>
        </Card>
      </main>
    );
  }

  if (clientId && (role === "client_owner" || role === "client_staff")) {
    const ctx: TenantContext = { role, clientId };
    const canViewCalls = role === "client_owner" || session.user.canViewCalls === true;
    const viewer = callViewerFor(session.user);
    const [overview, messageRows, callPage] = await Promise.all([
      ownerOverview(ctx, clientId, now),
      clientMessages(ctx).list(clientId),
      canViewCalls && viewer ? listCalls(viewer, clientId, { limit: 6 }) : Promise.resolve({ rows: [], nextCursor: null }),
    ]);

    const unpaidSelfServe =
      role === "client_owner" &&
      overview.selfServe &&
      !overview.paidAt &&
      overview.billingStatus !== "paid";

    if (unpaidSelfServe) {
      return (
        <main className="grid gap-6">
          <PageHeader eyebrow={formatDateLine(now)} title={`Hi ${greetingName}`} description={overview.clientName} />
          <Card className="grid max-w-lg gap-4">
            <h2 className="text-lg font-extrabold text-[var(--ink)]">Finish checkout</h2>
            <p className="text-sm text-[var(--muted)]">
              Your account is saved. Complete payment to set up your receptionist and get a number.
            </p>
            <ReopenCheckoutButton />
          </Card>
        </main>
      );
    }

    const showWelcome =
      role === "client_owner" &&
      overview.selfServe &&
      Boolean(overview.paidAt || overview.billingStatus === "paid") &&
      !overview.wizardSubmittedAt;

    const recentMessages = messageRows.slice(0, 6);
    // Audit trail: one row for the list, with how many messages were shown.
    await logMessageList(session.user, clientId, recentMessages.length);
    const callLinks =
      viewer && recentMessages.length > 0
        ? await callLinksFor(
            viewer,
            clientId,
            recentMessages.map((row) => row.retellCallId),
          )
        : new Map<string, string>();

    return (
      <main className="grid gap-6">
        <PageHeader
          eyebrow={formatDateLine(now)}
          title={`Hi ${greetingName}, here's today`}
          description={overview.clientName}
          actions={
            role === "client_owner" ? (
              <Link href="/home/business">
                <Button variant="secondary">Edit my business</Button>
              </Link>
            ) : null
          }
        />

        {showWelcome ? (
          <SectionCard title="Welcome — three steps to go live">
            <ol className="grid gap-0">
              <li className="grid gap-1 border-b border-[var(--line)] px-5 py-4">
                <p className="font-bold text-[var(--ink)]">1. Set up your receptionist</p>
                <p className="text-sm text-[var(--muted)]">Answer a short AI chat about your business.</p>
                <Link className="text-sm font-bold" href="/home/business/interview">
                  Start the chat
                </Link>
              </li>
              <li className="grid gap-1 border-b border-[var(--line)] px-5 py-4">
                <p className="font-bold text-[var(--ink)]">2. Review and submit</p>
                <p className="text-sm text-[var(--muted)]">Check the draft, then send it for our review.</p>
                <Link className="text-sm font-bold" href="/home/business/setup">
                  Review and submit
                </Link>
              </li>
              <li className="grid gap-1 px-5 py-4">
                <p className="font-bold text-[var(--ink)]">3. We review and connect your number</p>
                <p className="text-sm text-[var(--muted)]">
                  After you submit, we review your setup and connect your phone number.
                </p>
              </li>
            </ol>
          </SectionCard>
        ) : null}

        {role === "client_owner" && overview.billingStatus === "paused" ? (
          <Card className="grid gap-3 border-[var(--warning)] bg-[var(--warning-soft)]">
            <h2 className="text-lg font-extrabold text-[var(--ink)]">Ava is paused: update your card</h2>
            <p className="text-sm text-[var(--muted)]">
              Payment is past due, so Ava is not answering calls. Update your card to resume.
            </p>
            <Link href="/home/billing">
              <Button variant="primary">Update billing</Button>
            </Link>
          </Card>
        ) : null}

        <section className={`grid gap-3 sm:grid-cols-2 ${canViewCalls ? "xl:grid-cols-3" : ""}`}>
          {canViewCalls ? (
            <StatCard
              icon={<Phone className="h-5 w-5 text-[var(--primary)]" />}
              value={overview.callsThisWeek}
              label="Calls this week"
            />
          ) : null}
          <StatCard
            icon={<MessageSquare className="h-5 w-5 text-[var(--primary)]" />}
            value={overview.messagesThisWeek}
            label="Messages this week"
          />
          <Card className="grid gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)]">
                <Clock3 className="h-5 w-5 text-[var(--primary)]" />
              </span>
              <div>
                <p className="text-[28px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">
                  {overview.minutesUsed}
                  <span className="text-base font-bold text-[var(--muted)]"> / {overview.minutesIncluded}</span>
                </p>
                <p className="text-[13px] font-semibold text-[var(--muted)]">
                  Minutes used · {overview.planName ?? "No plan"}
                </p>
              </div>
            </div>
            <ProgressBar value={overview.minutesUsed} max={overview.minutesIncluded || 1} />
          </Card>
        </section>

        <div className={`grid gap-6 ${canViewCalls ? "lg:grid-cols-2" : ""}`}>
          {canViewCalls ? (
            <SectionCard
              title="Latest calls"
              action={
                <Link className="text-sm font-bold no-underline" href="/home/calls">
                  See all
                </Link>
              }
            >
              {callPage.rows.length === 0 ? (
                <EmptyState title="No calls yet" description="When Ava answers, they show up here." />
              ) : (
                callPage.rows.map((call) => (
                  <Link
                    key={call.id}
                    href={`/home/calls/${call.id}`}
                    className="grid grid-cols-[5rem_minmax(0,1fr)_auto_4rem] items-center gap-3 px-5 py-3 text-sm text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]"
                  >
                    <span className="text-[var(--muted)]">{formatTime(call.startedAt)}</span>
                    <span className="truncate font-semibold">{call.caller}</span>
                    <Pill tone="neutral">{outcomeLabel(call.outcome, call.endReason)}</Pill>
                    <span className="text-right tabular-nums text-[var(--muted)]">
                      {formatDuration(call.durationSeconds)}
                    </span>
                  </Link>
                ))
              )}
            </SectionCard>
          ) : null}

          <SectionCard title="Recent messages">
            {recentMessages.length === 0 ? (
              <EmptyState title="No messages yet" description="Taken messages will land here." />
            ) : (
              recentMessages.map((message) => {
                const callId = message.retellCallId ? callLinks.get(message.retellCallId) : undefined;
                return (
                  <div key={message.id} className="grid gap-1 px-5 py-4 text-sm" id={message.id === recentMessages[0]?.id ? "messages" : undefined}>
                    <p className="font-bold text-[var(--ink)]">{message.callerName}</p>
                    <p className="text-[var(--body)]">{message.body}</p>
                    <p className="text-[var(--muted)]">
                      {formatLocalTime(message.createdAt, overview.timezone)}
                      {callId && canViewCalls ? (
                        <>
                          {" "}
                          · <Link href={`/home/calls/${callId}`}>View call</Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                );
              })
            )}
          </SectionCard>
        </div>

        <Card className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-[var(--ink)]">Your receptionist</h2>
              {overview.agentLive ? <Pill tone="live">On a call</Pill> : <Pill tone="success">Ready</Pill>}
            </div>
            <p className="text-sm text-[var(--muted)]">
              {overview.publicPhone ? `Public number · ${overview.publicPhone}` : "No public number yet."}
            </p>
            {overview.agentLive && overview.liveCallId && canViewCalls ? (
              <Link className="text-sm font-bold" href={`/home/calls/${overview.liveCallId}`}>
                View live call
              </Link>
            ) : null}
          </div>
          {role === "client_owner" ? (
            <Link href="/home/business">
              <Button variant="secondary">Edit my business</Button>
            </Link>
          ) : null}
        </Card>
      </main>
    );
  }

  return (
    <main className="grid gap-6">
      <PageHeader title={`Hi ${greetingName}`} description={formatDateLine(now)} />
      <EmptyState title="Nothing here yet" description="Ask an admin to attach your account to a client." />
    </main>
  );
}
