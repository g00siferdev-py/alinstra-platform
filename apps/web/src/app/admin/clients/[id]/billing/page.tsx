import { PlanChangeReview } from "@/components/plan-change-review";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { clients, formatPlanCents, listPlanChangeRequests } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function AdminClientBillingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const requests = await listPlanChangeRequests({ id: "admin", role: "admin" }, id);

  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>
        Back to {client.name}
      </Link>
      <PageHeader title="Billing" description={`${client.name} · ${client.billingStatus}`} />
      <Card className="grid gap-2">
        <p className="text-sm">Status: {client.billingStatus}</p>
        <p className="text-sm">Past due since: {client.pastDueSince?.toISOString() ?? "—"}</p>
        <p className="text-sm">
          Period: {client.stripeCurrentPeriodStart?.toISOString() ?? "—"} → {client.stripeCurrentPeriodEnd?.toISOString() ?? "—"}
        </p>
        <p className="text-sm">Pending plan: {client.pendingPlanId ?? "—"}</p>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold">Plan change requests</h2>
        {requests.length === 0 ? (
          <EmptyState title="No plan changes" description="Owner requests will show up here." />
        ) : (
          requests.map((row) => (
            <div key={row.id} className="grid gap-2 border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0">
              <p className="font-bold">
                {row.fromPlan.name} → {row.toPlan.name} ({row.direction})
              </p>
              <p className="text-sm text-[var(--muted)]">
                {row.status} · {formatPlanCents(row.toPlan.monthlyPriceCents)}/mo
              </p>
              {row.status === "pending" ? <PlanChangeReview id={row.id} /> : null}
            </div>
          ))
        )}
      </Card>
    </main>
  );
}
