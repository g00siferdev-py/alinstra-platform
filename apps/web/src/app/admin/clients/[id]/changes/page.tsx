import { ChangeRequestReview, HeldUpdateReview } from "@/components/change-review";
import { changeRequests, clients, quickUpdates } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return JSON.stringify(payload, null, 2);
}

export default async function ClientChangesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const [updates, requests] = await Promise.all([
    quickUpdates({ role: "admin" }).list(id),
    changeRequests({ role: "admin" }).list(id),
  ]);
  const held = updates.filter((update) => update.status === "held");
  const pending = requests.filter((request) => request.status === "pending");

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>Back to {client.name}</Link>
      <h1 className="text-2xl font-semibold">Change requests</h1>
      <section className="grid gap-3">
        <h2 className="font-medium">Held quick updates</h2>
        {held.length === 0 ? <p className="text-sm text-[var(--muted)]">None waiting.</p> : null}
        {held.map((update) => (
          <HeldUpdateReview key={update.id} id={update.id} kind={update.kind} holdReason={update.holdReason} payload={payloadText(update.payload)} />
        ))}
      </section>
      <section className="grid gap-3">
        <h2 className="font-medium">Configuration requests</h2>
        {pending.length === 0 ? <p className="text-sm text-[var(--muted)]">None waiting.</p> : null}
        {pending.map((request) => (
          <ChangeRequestReview
            key={request.id}
            id={request.id}
            category={request.category}
            description={request.description}
            feeCents={request.feeCents}
          />
        ))}
      </section>
    </main>
  );
}
