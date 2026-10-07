import { RemoveClientButton } from "@/components/client-actions";
import { CreateClientZeroButton } from "@/components/provision-panel";
import { Button, EmptyState, PageHeader, Pill, SectionCard } from "@/components/ui";
import { clientStatusDisplay, clientStatusSortRank } from "@/lib/client-status-display";
import { clientCanBeRemoved, clients, plans } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function ClientsPage() {
  await requireAdmin();
  const [rows, planRows] = await Promise.all([clients({ role: "admin" }).list(), plans({ role: "admin" }).list()]);
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
  const sorted = [...rows].sort((a, b) => clientStatusSortRank(a) - clientStatusSortRank(b));
  return (
    <main className="grid gap-6">
      <PageHeader
        title="Clients"
        actions={
          <>
            <CreateClientZeroButton />
            <Link href="/admin/clients/new">
              <Button>Add client</Button>
            </Link>
          </>
        }
      />
      <SectionCard title="All clients">
        {sorted.length === 0 ? (
          <EmptyState title="No clients yet" description="Add a client or create client zero to get started." />
        ) : (
          sorted.map((client) => {
            const statusDisplay = clientStatusDisplay(client);
            return (
            <div key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <Link href={`/admin/clients/${client.id}`} className="font-bold text-[var(--ink)] no-underline">
                  {client.name}
                </Link>
                <p className="text-sm text-[var(--muted)]">
                  {client.industry ?? "no industry"} · {statusDisplay.label}
                  {client.planId ? <> · {planName.get(client.planId)}</> : null}
                </p>
                {statusDisplay.awaitingReview ? (
                  <Pill tone="warning" className="mt-2">
                    Awaiting your review
                  </Pill>
                ) : null}
                {client.wizardSubmittedAt && !statusDisplay.awaitingReview ? (
                  <Pill tone="info" className="mt-2">
                    Wizard submitted
                  </Pill>
                ) : null}
                {client.selfServe ? (
                  <Pill tone="warning" className="mt-2">
                    Self-serve
                  </Pill>
                ) : null}
                {!client.wizardSubmittedAt && client.wizardDraft && !client.wizardDraft.discardedAt ? (
                  <Link className="mt-1 block text-sm font-semibold" href={`/admin/clients/${client.id}/wizard`}>
                    Continue setup · step {client.wizardDraft.currentStep}
                  </Link>
                ) : null}
              </div>
              {clientCanBeRemoved(client.status) ? <RemoveClientButton clientId={client.id} name={client.name} /> : null}
            </div>
            );
          })
        )}
      </SectionCard>
    </main>
  );
}
