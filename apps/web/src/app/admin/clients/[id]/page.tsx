import { ClientActions } from "@/components/client-actions";
import { ProvisionPanel } from "@/components/provision-panel";
import { callRecords, changeLogs, clientCanBeRemoved, clientMessages, clients, formatTransferTargets, knowledgeBases, knowledgeDocuments, plans, transferTargets, users } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const [plan, knowledge, documents, logs, people, targets, messages, calls] = await Promise.all([
    client.planId ? plans({ role: "admin" }).getById(client.planId) : Promise.resolve(null),
    knowledgeBases({ role: "admin" }).getCurrent(id),
    knowledgeDocuments({ role: "admin" }).list(id),
    changeLogs({ role: "admin" }).list(id),
    users({ role: "admin", clientId: id }).list(),
    transferTargets({ role: "admin" }).list(id),
    clientMessages({ role: "admin" }).list(id),
    callRecords({ role: "admin" }).list(id),
  ]);
  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/admin/clients">Clients</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <p className="text-sm text-[var(--muted)]">{client.status}{client.wizardSubmittedAt ? " · Wizard submitted" : ""}</p>
        </div>
        <ClientActions
          clientId={client.id}
          name={client.name}
          email={client.portalOwnerEmail}
          canDiscard={!client.wizardSubmittedAt}
          canRemove={clientCanBeRemoved(client.status)}
        />
      </header>
      {!client.wizardSubmittedAt ? <Link href={`/admin/clients/${client.id}/wizard`}>Continue wizard</Link> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/admin/clients/${client.id}/agent`}>Agent config</Link>
        <Link href={`/admin/clients/${client.id}/changes`}>Change requests</Link>
      </div>
      <ProvisionPanel
        clientId={client.id}
        status={client.status}
        syncStatus={client.agentSyncStatus}
        syncError={client.agentSyncError}
        checkoutUrl={client.stripeCheckoutUrl}
        billingStatus={client.billingStatus}
        phone={client.phoneE164}
        targets={formatTransferTargets(targets)}
        internal={client.internal}
      />
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Messages</h2>
        {messages.length === 0 ? <p className="text-sm text-[var(--muted)]">No messages yet.</p> : null}
        <ul className="grid gap-2 text-sm">
          {messages.map((message) => (
            <li key={message.id}>{message.createdAt.toISOString()} · {message.callerName} · {message.callbackNumber} · {message.body}</li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Calls</h2>
        {calls.length === 0 ? <p className="text-sm text-[var(--muted)]">No calls yet.</p> : null}
        <ul className="grid gap-1 text-sm">
          {calls.map((call) => (
            <li key={call.id}>{call.callerMasked} · {call.durationSeconds ?? "—"}s · {call.endReason ?? "in progress"}</li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Overview</h2>
        <p className="text-sm">Industry: {client.industry ?? "—"}</p>
        <p className="text-sm">Contact: {client.contactName ?? "—"} · {client.contactEmail ?? "—"}</p>
        <p className="text-sm">Timezone: {client.timezone}</p>
        <p className="text-sm">Plan: {plan?.name ?? "—"}{client.setupFeeWaived ? " · setup fee waived" : ""}</p>
        <p className="text-sm">
          Minutes included: {client.overrideIncludedMinutes ?? plan?.includedMinutes ?? "—"}
        </p>
        <p className="text-sm">Owner email on file: {client.portalOwnerEmail ?? "—"}</p>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Knowledge</h2>
        <p className="text-sm whitespace-pre-wrap">Hours: {knowledge?.hours ? String(knowledge.hours) : "—"}</p>
        <p className="text-sm whitespace-pre-wrap">Services: {knowledge?.services ? String(knowledge.services) : "—"}</p>
        <ul className="mt-2 text-sm">
          {documents.map((document) => (
            <li key={document.id}>
              <a href={`/api/knowledge/documents/${document.id}`}>{document.originalFilename}</a>
              {" "}({document.extractionStatus}{document.extractedTextTruncated ? ", truncated" : ""})
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Users</h2>
        <ul className="text-sm">
          {people.length === 0 ? <li>No portal users yet.</li> : null}
          {people.map((person) => (
            <li key={person.id}>{person.email} · {person.role}</li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-2 font-medium">Change log</h2>
        <ul className="grid gap-1 text-sm">
          {logs.map((entry) => (
            <li key={entry.id}>{entry.createdAt.toISOString()} · {entry.actorRole} · {entry.summary}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
