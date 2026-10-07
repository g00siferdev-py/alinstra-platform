import { ClientActions } from "@/components/client-actions";
import { ProvisionPanel } from "@/components/provision-panel";
import { Button, Card, EmptyState, PageHeader, Pill, SectionCard } from "@/components/ui";
import { getEnv } from "@alinstra/config";
import { OutcomeBadge } from "@/components/calls-list";
import { formatDuration } from "@/lib/call-view";
import {
  AGENT_AFFECTING_STEPS,
  callLinksFor,
  changeLogs,
  clientCanBeRemoved,
  clientMessages,
  clients,
  formatLocalTime,
  formatPhone,
  formatTransferTargets,
  knowledgeBases,
  knowledgeDocuments,
  listCalls,
  numberPurchaseFor,
  plans,
  PROVISION_STEPS,
  provisioningRuns,
  provisionStepLabel,
  TEARDOWN_STEPS,
  transferTargets,
  users,
  WIZARD_STEP_TITLES,
} from "@alinstra/db";
import { voiceDisplayName } from "@alinstra/providers";
import { logMessageList } from "@/lib/access-log";
import { clientStatusDisplay } from "@/lib/client-status-display";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

function orderedSteps(steps: Array<{ name: string; status: string; error: string | null }>, kind: string | null) {
  const order: readonly string[] = kind === "teardown" ? TEARDOWN_STEPS : PROVISION_STEPS;
  return order
    .map((name) => steps.find((step) => step.name === name))
    .filter((step): step is { name: string; status: string; error: string | null } => step !== undefined)
    .map((step) => ({ name: step.name, label: provisionStepLabel(step.name), status: step.status, error: step.error }));
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const viewer = { id: session.user.id, role: "admin" as const };
  const [plan, knowledge, documents, logs, people, targets, messages, calls, run] = await Promise.all([
    client.planId ? plans({ role: "admin" }).getById(client.planId) : Promise.resolve(null),
    knowledgeBases({ role: "admin" }).getCurrent(id),
    knowledgeDocuments({ role: "admin" }).list(id),
    changeLogs({ role: "admin" }).list(id),
    users({ role: "admin", clientId: id }).list(),
    transferTargets({ role: "admin" }).list(id),
    clientMessages({ role: "admin" }).list(id),
    listCalls(viewer, id, { limit: 5 }),
    provisioningRuns({ role: "admin" }).latest(id),
  ]);
  // Audit trail: one row for the messages list, with how many were shown.
  await logMessageList(session.user, id, messages.length);
  const callLinks = await callLinksFor(viewer, id, messages.map((row) => row.retellCallId));
  const when = (value: Date) => formatLocalTime(value, client.timezone);
  const clientVoice = client.voice && typeof client.voice === "object" ? (client.voice as { voiceId?: unknown; assistantName?: unknown }) : {};
  const env = getEnv();
  const numberPurchase = numberPurchaseFor(client.phone, {
    areaCode: env.RETELL_DEFAULT_AREA_CODE || null,
    tollFree: env.RETELL_DEFAULT_TOLL_FREE === "true",
  });
  const statusDisplay = clientStatusDisplay(client);
  const hasOwnerLogin = people.some((person) => person.role === "client_owner");
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/admin/clients">
        Clients
      </Link>
      <PageHeader
        title={client.name}
        description={
          statusDisplay.awaitingReview ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Pill tone="warning">{statusDisplay.label}</Pill>
              {client.wizardSubmittedAt ? <span>· Wizard submitted</span> : null}
            </span>
          ) : (
            `${statusDisplay.label}${client.wizardSubmittedAt ? " · Wizard submitted" : ""}`
          )
        }
        actions={
          <ClientActions
            clientId={client.id}
            name={client.name}
            email={client.portalOwnerEmail}
            canDiscard={!client.wizardSubmittedAt}
            canRemove={clientCanBeRemoved(client.status)}
            showPortalInvite={!hasOwnerLogin}
          />
        }
      />
      {!client.wizardSubmittedAt ? (
        <Link href={`/admin/clients/${client.id}/wizard`}>
          <Button variant="secondary">Continue wizard</Button>
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <Link href={`/admin/clients/${client.id}/agent`}>Agent config</Link>
        <Link href={`/admin/clients/${client.id}/calls`}>Calls</Link>
        <Link href={`/admin/clients/${client.id}/changes`}>Change requests</Link>
        <Link href={`/admin/clients/${client.id}/billing`}>Billing</Link>
        <Link href={`/admin/clients/${client.id}/access`}>Access history</Link>
      </div>
      <ProvisionPanel
        clientId={client.id}
        status={client.status}
        syncStatus={client.agentSyncStatus}
        syncError={client.agentSyncError}
        checkoutUrl={client.stripeCheckoutUrl}
        billingStatus={client.billingStatus}
        phone={client.phoneE164}
        phoneDisplay={client.phoneE164 ? formatPhone(client.phoneE164) : null}
        targets={formatTransferTargets(targets)}
        internal={client.internal}
        runStatus={run?.status ?? null}
        runKind={run?.kind ?? null}
        steps={orderedSteps(run?.steps ?? [], run?.kind ?? null)}
        numberApproved={Boolean(run?.numberApprovedAt)}
        numberPurchase={numberPurchase}
        voiceName={voiceDisplayName(clientVoice.voiceId)}
        appEnv={env.APP_ENV}
      />
      {client.wizardSubmittedAt ? (
        <Card className="grid gap-3">
          <h2 className="text-base font-extrabold text-[var(--ink)]">Edit</h2>
          <p className="text-sm text-[var(--muted)]">
            Each step saves straight to this client. Steps marked with a dot update Ava{client.retellAgentId ? " within about a minute" : " once the client is live"}.
          </p>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {WIZARD_STEP_TITLES.map((title, index) => {
              const step = index + 1;
              const review = step === WIZARD_STEP_TITLES.length;
              return (
                <li key={title} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-1.5">
                  <span>
                    {step}. {review ? "Review" : title}
                    {AGENT_AFFECTING_STEPS.has(step) ? <span aria-label="updates Ava" className="ml-1 text-[var(--muted)]">·</span> : null}
                  </span>
                  <Link className="text-xs font-semibold" href={`/admin/clients/${client.id}/wizard?step=${step}&mode=edit`}>{review ? "Open" : "Edit"}</Link>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}
      <SectionCard title="Messages">
        {messages.length === 0 ? (
          <EmptyState title="No messages yet" />
        ) : (
          messages.map((message) => {
            const callId = message.retellCallId ? callLinks.get(message.retellCallId) : undefined;
            return (
              <div key={message.id} className="px-5 py-4 text-sm" id={message.id === messages[0]?.id ? "messages" : undefined}>
                {when(message.createdAt)} · {message.callerName} · {message.callbackNumber} · {message.body}
                {callId ? (
                  <>
                    {" "}
                    · <Link href={`/admin/clients/${client.id}/calls/${callId}`}>View call</Link>
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </SectionCard>
      <SectionCard
        title="Calls"
        action={
          <Link className="text-sm font-bold no-underline" href={`/admin/clients/${client.id}/calls`}>
            All calls
          </Link>
        }
      >
        {calls.rows.length === 0 ? (
          <EmptyState title="No calls yet" />
        ) : (
          calls.rows.map((call) => (
            <div key={call.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
              <Link className="font-semibold" href={`/admin/clients/${client.id}/calls/${call.id}`}>
                {call.startedAt ? when(call.startedAt) : "—"}
              </Link>
              <span>
                · {call.caller} · {formatDuration(call.durationSeconds)}
              </span>
              <OutcomeBadge outcome={call.outcome} endReason={call.endReason} />
            </div>
          ))
        )}
        <p className="border-t border-[var(--divider)] px-5 py-3 text-sm text-[var(--muted)]">
          Retention: {client.callRetentionDays} days · Last purge:{" "}
          {client.lastCallPurgeAt
            ? `${when(client.lastCallPurgeAt)}, ${client.lastCallPurgeCount ?? 0} call${client.lastCallPurgeCount === 1 ? "" : "s"}`
            : "not yet run"}
        </p>
      </SectionCard>
      <Card className="grid gap-2">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Overview</h2>
        <p className="text-sm">Industry: {client.industry ?? "—"}</p>
        <p className="text-sm">Contact: {client.contactName ?? "—"} · {client.contactEmail ?? "—"}</p>
        <p className="text-sm">Timezone: {client.timezone}</p>
        <p className="text-sm">Voice: {voiceDisplayName(clientVoice.voiceId)} · Assistant name: {typeof clientVoice.assistantName === "string" && clientVoice.assistantName.trim() ? clientVoice.assistantName : "Ava"}</p>
        <p className="text-sm">Plan: {plan?.name ?? "—"}{client.setupFeeWaived ? " · setup fee waived" : ""}</p>
        <p className="text-sm">Minutes included: {client.overrideIncludedMinutes ?? plan?.includedMinutes ?? "—"}</p>
        <p className="text-sm">
          Billing: {client.billingStatus}
          {client.billingStatus === "paused" ? " · Ava is paused until the card is updated" : ""}
          {client.pastDueSince ? ` · past due since ${when(client.pastDueSince)}` : ""}
        </p>
        <p className="text-sm">Owner email on file: {client.portalOwnerEmail ?? "—"}</p>
      </Card>
      <Card className="grid gap-2">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Knowledge</h2>
        <p className="whitespace-pre-wrap text-sm">Hours: {knowledge?.hours ? String(knowledge.hours) : "—"}</p>
        <p className="whitespace-pre-wrap text-sm">Services: {knowledge?.services ? String(knowledge.services) : "—"}</p>
        <ul className="mt-2 text-sm">
          {documents.map((document) => (
            <li key={document.id}>
              <a href={`/api/knowledge/documents/${document.id}`}>{document.originalFilename}</a> ({document.extractionStatus}
              {document.extractedTextTruncated ? ", truncated" : ""})
            </li>
          ))}
        </ul>
      </Card>
      <Card className="grid gap-2">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Users</h2>
        <ul className="text-sm">
          {people.length === 0 ? <li className="text-[var(--muted)]">No portal users yet.</li> : null}
          {people.map((person) => (
            <li key={person.id}>
              {person.email} · {person.role}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="grid gap-2">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Change log</h2>
        <ul className="grid gap-1 text-sm">
          {logs.map((entry) => (
            <li key={entry.id}>
              {when(entry.createdAt)} · {entry.actorRole} · {entry.summary}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
