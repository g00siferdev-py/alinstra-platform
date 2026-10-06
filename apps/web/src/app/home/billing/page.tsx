import { BillingActions } from "@/components/billing-actions";
import { Card, EmptyState, PageHeader, Pill, ProgressBar, SectionCard } from "@/components/ui";
import {
  formatPlanCents,
  listPlanChangeRequests,
  ownerBillingOverview,
  plans,
} from "@alinstra/db";
import { requireUser } from "@/lib/session";
import { notFound } from "next/navigation";

function statusLabel(status: string): string {
  if (status === "paid") return "Paid";
  if (status === "past_due") return "Past due";
  if (status === "paused") return "Paused";
  if (status === "cancel_scheduled") return "Canceling";
  if (status === "checkout_open") return "Checkout open";
  return status.replaceAll("_", " ");
}

function statusTone(status: string): "success" | "warning" | "neutral" | "live" {
  if (status === "paid") return "success";
  if (status === "past_due" || status === "paused") return "warning";
  return "neutral";
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function OwnerBillingPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  const actor = { id: session.user.id, role: "client_owner" as const, clientId: session.user.clientId };
  const [billing, catalog, requests] = await Promise.all([
    ownerBillingOverview(actor, session.user.clientId),
    plans(actor).list(),
    listPlanChangeRequests(actor),
  ]);
  const openRequest = requests.find((row) => row.status === "pending" || row.status === "scheduled");
  const otherPlans = catalog.filter((plan) => plan.code !== billing.planCode);

  return (
    <main className="grid gap-6">
      <PageHeader title="Billing" description="Plan, usage this period, and card updates." />

      {billing.billingStatus === "paused" ? (
        <Card className="grid gap-2 border-[var(--warning)] bg-[var(--warning-soft)]">
          <h2 className="text-lg font-extrabold">Ava is paused: update your card</h2>
          <p className="text-sm text-[var(--muted)]">Payment is still past due. Update your card in Manage billing to resume.</p>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-extrabold text-[var(--ink)]">{billing.planName ?? "No plan"}</h2>
            <Pill tone={statusTone(billing.billingStatus)}>{statusLabel(billing.billingStatus)}</Pill>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {formatPlanCents(billing.monthlyPriceCents)}/month
            {billing.nextBillDate ? ` · Next bill ${formatDate(billing.nextBillDate)}` : ""}
          </p>
          {billing.pendingPlanName ? (
            <p className="text-sm text-[var(--muted)]">Downgrade to {billing.pendingPlanName} applies at the next renewal.</p>
          ) : null}
          <BillingActions
            hasStripeCustomer={billing.hasStripeCustomer}
            openRequestId={openRequest?.status === "pending" ? openRequest.id : null}
            plans={otherPlans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              monthlyPriceCents: plan.monthlyPriceCents,
              includedMinutes: plan.includedMinutes,
            }))}
          />
        </Card>

        <SectionCard title="This billing period">
          {!billing.periodStart || !billing.periodEnd ? (
            <EmptyState title="Period not set yet" description="Usage for this billing period will show after the first subscription event." />
          ) : (
            <div className="grid gap-3 px-5 py-4">
              <p className="text-sm text-[var(--muted)]">
                {formatDate(billing.periodStart)} – {formatDate(billing.periodEnd)}
              </p>
              <p className="text-[28px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">
                {billing.minutesUsed}
                <span className="text-base font-bold text-[var(--muted)]"> / {billing.includedMinutes} min</span>
              </p>
              <ProgressBar value={billing.minutesUsed} max={billing.includedMinutes || 1} />
              <p className="text-sm text-[var(--muted)]">
                Estimated overage so far: {formatPlanCents(billing.estimatedOverageCents)}
                {billing.overagePerMinuteCents > 0
                  ? ` (${formatPlanCents(billing.overagePerMinuteCents)}/min after included)`
                  : ""}
              </p>
            </div>
          )}
        </SectionCard>
      </section>

      {openRequest ? (
        <Card className="grid gap-2">
          <h2 className="text-base font-extrabold">Plan change request</h2>
          <p className="text-sm text-[var(--muted)]">
            {openRequest.fromPlan.name} → {openRequest.toPlan.name} · {openRequest.status}
            {openRequest.direction === "downgrade" && openRequest.status === "scheduled"
              ? " (applies at next renewal)"
              : ""}
          </p>
        </Card>
      ) : null}
    </main>
  );
}
