import { ChangeRequestReview, HeldUpdateReview } from "@/components/change-review";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { changeRequests, clients, openPayload, quickUpdates, receptionistFields } from "@alinstra/db";
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
  const fields = pending.length > 0 ? await receptionistFields({ role: "admin" }, id) : null;

  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>
        Back to {client.name}
      </Link>
      <PageHeader title="Change requests" />
      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Held quick updates</h2>
        {held.length === 0 ? <EmptyState title="None waiting" /> : null}
        {held.map((update) => (
          <HeldUpdateReview key={update.id} id={update.id} kind={update.kind} holdReason={update.holdReason} payload={payloadText(openPayload(update.payload))} />
        ))}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Configuration requests</h2>
        {pending.length === 0 ? <EmptyState title="None waiting" /> : null}
        {fields
          ? pending.map((request) => (
              <ChangeRequestReview
                key={request.id}
                id={request.id}
                category={request.category}
                description={request.description}
                feeCents={request.feeCents}
                fields={fields}
              />
            ))
          : null}
      </Card>
    </main>
  );
}
