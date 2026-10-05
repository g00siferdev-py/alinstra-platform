import { RemoveClientButton } from "@/components/client-actions";
import { CreateClientZeroButton } from "@/components/provision-panel";
import { Button, EmptyState, PageHeader, Pill, SectionCard } from "@/components/ui";
import { clientCanBeRemoved, clients, plans } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function ClientsPage() {
  await requireAdmin();
  const [rows, planRows] = await Promise.all([clients({ role: "admin" }).list(), plans({ role: "admin" }).list()]);
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
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
        {rows.length === 0 ? (
          <EmptyState title="No clients yet" description="Add a client or create client zero to get started." />
        ) : (
          rows.map((client) => (
            <div key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <Link href={`/admin/clients/${client.id}`} className="font-bold text-[var(--ink)] no-underline">
                  {client.name}
                </Link>
                <p className="text-sm text-[var(--muted)]">
                  {client.industry ?? "no industry"} · {client.status}
                  {client.planId ? <> · {planName.get(client.planId)}</> : null}
                </p>
                {client.wizardSubmittedAt ? (
                  <Pill tone="info" className="mt-2">
                    Wizard submitted
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
          ))
        )}
      </SectionCard>
    </main>
  );
}
