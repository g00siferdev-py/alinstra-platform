import { RemoveClientButton } from "@/components/client-actions";
import { CreateClientZeroButton } from "@/components/provision-panel";
import { clientCanBeRemoved, clients, plans } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function ClientsPage() {
  await requireAdmin();
  const [rows, planRows] = await Promise.all([clients({ role: "admin" }).list(), plans({ role: "admin" }).list()]);
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <div className="flex gap-2">
          <CreateClientZeroButton />
          <Link className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)]" href="/admin/clients/new">Add client</Link>
        </div>
      </div>
      <ul className="grid gap-2">
        {rows.map((client) => (
          <li key={client.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
            <div className="min-w-0">
              <Link href={`/admin/clients/${client.id}`}>
                <span className="font-medium">{client.name}</span>
              </Link>
              <span className="ml-2 text-sm text-[var(--muted)]">{client.industry ?? "no industry"} · {client.status}</span>
              {client.planId ? <span className="ml-2 text-sm">{planName.get(client.planId)}</span> : null}
              {client.wizardSubmittedAt ? <span className="ml-2 rounded bg-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent-ink)]">Wizard submitted</span> : null}
              {!client.wizardSubmittedAt && client.wizardDraft && !client.wizardDraft.discardedAt ? (
                <Link className="mt-1 block text-sm" href={`/admin/clients/${client.id}/wizard`}>
                  Continue setup · step {client.wizardDraft.currentStep}
                </Link>
              ) : null}
            </div>
            {clientCanBeRemoved(client.status) ? <RemoveClientButton clientId={client.id} name={client.name} /> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
