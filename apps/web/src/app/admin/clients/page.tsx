import { RemoveClientButton } from "@/components/client-actions";
import { CreateClientZeroButton } from "@/components/provision-panel";
import { Button, EmptyState, PageHeader, Pill, SectionCard } from "@/components/ui";
import { clientStatusDisplay, clientStatusSortRank } from "@/lib/client-status-display";
import { clientCanBeRemoved, clients, plans } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = rawView === "held" || rawView === "auto" ? rawView : undefined;
  const [rows, planRows] = await Promise.all([clients({ role: "admin" }).list(), plans({ role: "admin" }).list()]);
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sorted = [...rows]
    .filter((client) => {
      if (view === "held") return client.status === "held_for_review" || clientStatusDisplay(client).awaitingReview;
      if (view === "auto") return Boolean(client.autoGoLiveAt && client.autoGoLiveAt.getTime() >= weekAgo);
      return true;
    })
    .sort((a, b) => clientStatusSortRank(a) - clientStatusSortRank(b));
  return (
    <main className="grid gap-6">
      <PageHeader
        title="Clients"
        actions={
          <>
            <Link href={view === "held" ? "/admin/clients" : "/admin/clients?view=held"}>
              <Button variant={view === "held" ? "primary" : "secondary"}>Held for review</Button>
            </Link>
            <Link href={view === "auto" ? "/admin/clients" : "/admin/clients?view=auto"}>
              <Button variant={view === "auto" ? "primary" : "secondary"}>Auto go-live (last 7 days)</Button>
            </Link>
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
                    Held for review
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
