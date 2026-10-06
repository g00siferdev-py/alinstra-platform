import { CallRetentionForm } from "@/components/call-retention-form";
import { OutcomeBadge } from "@/components/calls-list";
import { QuickUpdateForms } from "@/components/quick-update-forms";
import { formatDuration } from "@/lib/call-view";
import { callViewerFor } from "@/lib/call-viewer";
import { interviewEnabled } from "@/lib/interview-config";
import { requireUser } from "@/lib/session";
import {
  AGENT_AFFECTING_STEPS,
  canViewClientCalls,
  clients,
  faqItems,
  formatLocalTime,
  formatTransferTargets,
  knowledgeBases,
  listCalls,
  needsOwnNumberForwarding,
  OWNER_BLOCKED_STEP_HINT,
  OWNER_BLOCKED_STEPS,
  OWNER_STEP_HOLD_KIND,
  phoneModeOf,
  plans,
  quickUpdates,
  transferTargets,
  WIZARD_STEP_TITLES,
} from "@alinstra/db";
import { Card, EmptyState, PageHeader, SectionCard } from "@/components/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

function submittedStepSummary(step: number | undefined, payload: Record<string, unknown> | undefined): string {
  if (!step || !payload) return "";
  const section =
    step === 4 ? payload.coverage
    : step === 5 ? payload.features
    : step === 6 ? payload.voice
    : step === 7 ? payload.knowledge
    : null;
  if (!section || typeof section !== "object") return "";
  return Object.entries(section as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

export default async function MyBusinessPage() {
  const session = await requireUser();
  if (session.user.role === "admin" || !session.user.clientId) notFound();
  const ctx = { role: session.user.role as "client_owner" | "client_staff", clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client) notFound();
  if (
    session.user.role === "client_owner" &&
    client.selfServe &&
    !client.paidAt &&
    client.billingStatus !== "paid"
  ) {
    redirect("/home");
  }
  const viewer = callViewerFor(session.user);
  const showCalls = Boolean(viewer && canViewClientCalls(viewer, client.id));
  const [plan, knowledge, targets, updates, calls] = await Promise.all([
    client.planId ? plans(ctx).getById(client.planId) : Promise.resolve(null),
    knowledgeBases(ctx).getCurrent(session.user.clientId),
    transferTargets(ctx).list(session.user.clientId),
    quickUpdates(ctx).list(session.user.clientId),
    showCalls && viewer ? listCalls(viewer, client.id, { limit: 5 }) : Promise.resolve({ rows: [], nextCursor: null }),
  ]);
  const owner = session.user.role === "client_owner";
  const faqs = faqItems(knowledge?.faqs);
  const reviewRows = updates.filter((row) => row.status === "held" || (row.status === "rejected" && row.kind === OWNER_STEP_HOLD_KIND)).slice(0, 10);
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="My business"
        description={
          owner
            ? "Edit each section below, or use the quick updates for hours, notices, staff, and one FAQ at a time."
            : "Read only. Ask the account owner to change hours, notices, staff, or FAQs."
        }
      />
      {owner && !client.wizardSubmittedAt && interviewEnabled() ? (
        <Card className="text-sm">
          <Link className="font-bold" href="/home/business/interview">
            Set up your receptionist
          </Link>
          {" — "}
          answer a short interview, then{" "}
          <Link className="font-bold" href="/home/business/setup">
            review and submit
          </Link>{" "}
          before anything goes live.
        </Card>
      ) : null}
      <Card className="text-sm">
        <p>{client.name}{client.namePronunciation ? ` · pronounced ${client.namePronunciation}` : ""}</p>
        <p>{client.contactName} · {client.contactEmail}</p>
        <p>{client.timezone}</p>
        <p>Plan: {plan?.name ?? "—"}</p>
        <p className="mt-3 whitespace-pre-wrap">Hours: {knowledge?.hours ? String(knowledge.hours) : "—"}</p>
        <p className="whitespace-pre-wrap">Services: {knowledge?.services ? String(knowledge.services) : "—"}</p>
        <p className="whitespace-pre-wrap">Policies: {knowledge?.policies ? String(knowledge.policies) : "—"}</p>
        <p className="whitespace-pre-wrap">Notices: {knowledge?.notices ? String(knowledge.notices) : "—"}</p>
        <p className="whitespace-pre-wrap">Staff: {knowledge?.staff ? String(knowledge.staff) : "—"}</p>
        {needsOwnNumberForwarding(client.phone) ? (
          <p className="mt-3">
            <Link className="underline" href="/home/business/forwarding">Forward your number</Link>
            {" "}— set conditional forwarding to your Alinstra number.
          </p>
        ) : phoneModeOf(client.phone) === "new_number" ? (
          <p className="mt-3 text-[var(--muted)]">
            You use an Alinstra number, so carrier forwarding is not needed.{" "}
            <span className="opacity-70">Forwarding setup is only for clients who keep their own number.</span>
          </p>
        ) : null}
      </Card>

      {showCalls ? (
        <SectionCard
          title="Recent calls"
          action={
            <Link className="text-sm font-bold no-underline" href="/home/calls">
              All calls
            </Link>
          }
        >
          {calls.rows.length === 0 ? (
            <EmptyState title="No calls yet" />
          ) : (
            calls.rows.map((call) => (
              <div key={call.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <Link className="font-semibold" href={`/home/calls/${call.id}`}>
                  {call.startedAt ? formatLocalTime(call.startedAt, client.timezone) : "—"}
                </Link>
                <span>
                  · {call.caller} · {formatDuration(call.durationSeconds)}
                </span>
                <OutcomeBadge outcome={call.outcome} endReason={call.endReason} />
              </div>
            ))
          )}
        </SectionCard>
      ) : null}

      {owner && reviewRows.length > 0 ? (
        <Card className="grid gap-3">
          <h2 className="text-base font-extrabold text-[var(--ink)]">Waiting for review</h2>
          <ul className="grid gap-2 text-sm">
            {reviewRows.map((row) => {
              const body = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
                ? (row.payload as { title?: string; step?: number; payload?: Record<string, unknown> })
                : {};
              const label = typeof body.title === "string" ? body.title : row.kind;
              const submitted = submittedStepSummary(body.step, body.payload);
              return (
                <li key={row.id} className="rounded-md border border-[var(--line)] px-3 py-2">
                  <div className="font-medium">
                    {row.status === "held" ? "Waiting for review" : "Rejected"} · {label}
                  </div>
                  <p className="text-[var(--muted)]">{formatLocalTime(row.createdAt, client.timezone)}</p>
                  {row.holdReason ? <p className="mt-1">{row.holdReason}</p> : null}
                  {submitted ? <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--muted)]">{submitted}</pre> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {owner && client.wizardSubmittedAt ? (
        <Card className="grid gap-3">
          <h2 className="text-base font-extrabold text-[var(--ink)]">Edit</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Each step saves to your business{client.retellAgentId ? " and Ava updates within about a minute" : ""}. Steps marked with a dot change what Ava says.
          </p>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {WIZARD_STEP_TITLES.slice(0, 10).map((title, index) => {
              const step = index + 1;
              const blocked = OWNER_BLOCKED_STEPS.has(step);
              return (
                <li key={title} className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-1.5">
                  <span>
                    {step}. {title}
                    {AGENT_AFFECTING_STEPS.has(step) ? <span aria-label="updates Ava" className="ml-1 text-[var(--muted)]">·</span> : null}
                  </span>
                  {blocked ? (
                    <span className="text-xs text-[var(--muted)]" title={OWNER_BLOCKED_STEP_HINT}>Email support</span>
                  ) : (
                    <Link className="text-xs underline" href={`/home/business/edit/${step}`}>Edit</Link>
                  )}
                </li>
              );
            })}
          </ol>
          {OWNER_BLOCKED_STEPS.size > 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">Plan and Compliance: {OWNER_BLOCKED_STEP_HINT}</p>
          ) : null}
        </Card>
      ) : null}

      {owner && client.wizardSubmittedAt ? (
        <Card>
          <CallRetentionForm days={client.callRetentionDays} />
        </Card>
      ) : null}

      {owner && client.wizardSubmittedAt ? (
        <QuickUpdateForms
          hours={typeof knowledge?.hours === "string" ? knowledge.hours : ""}
          staff={typeof knowledge?.staff === "string" ? knowledge.staff : ""}
          faqs={faqs}
          targets={formatTransferTargets(targets)}
        />
      ) : null}
    </main>
  );
}
