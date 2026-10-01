import { clients, plans } from "@alinstra/db";
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
        <Link className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm" href="/admin/clients/new">Add client</Link>
      </div>
      <ul className="grid gap-2">
        {rows.map((client) => (
          <li key={client.id} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
            <Link href={client.wizardSubmittedAt ? `/admin/clients/${client.id}` : `/admin/clients/${client.id}/wizard`}>
              <span className="font-medium">{client.name}</span>
              <span className="ml-2 text-sm text-[var(--muted)]">{client.industry ?? "no industry"} · {client.status} · step {client.wizardDraft?.currentStep ?? 1}</span>
              {client.planId ? <span className="ml-2 text-sm">{planName.get(client.planId)}</span> : null}
              {client.wizardSubmittedAt ? <span className="ml-2 rounded bg-[var(--accent)] px-2 py-0.5 text-xs">Wizard submitted</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
