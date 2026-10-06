import { Pill } from "@/components/ui";
import { FOUNDING_OFFER } from "@/lib/brand";
import { formatTypicalCallsLine, planMarketingFor } from "@/lib/marketing-plans";
import { formatPlanCents, type PublicPlan } from "@alinstra/db";

export function SignupPlanSummary({ plan }: { plan: PublicPlan }) {
  const meta = planMarketingFor(plan.code);
  const waive = FOUNDING_OFFER.active && meta.foundingWaiver;

  return (
    <aside className="grid h-fit gap-4 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-5 py-6 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_8px_24px_rgba(15,27,45,0.06)]">
      <div className="grid gap-1">
        <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">YOUR PLAN</p>
        <h2 className="text-2xl font-extrabold text-[var(--ink)]">{plan.name}</h2>
        {meta.tagline ? <p className="text-sm text-[var(--muted)]">{meta.tagline}</p> : null}
      </div>
      <p className="text-[40px] font-extrabold tracking-tight leading-none text-[var(--ink)]">
        {formatPlanCents(plan.monthlyPriceCents)}
        <span className="text-[15px] font-bold text-[var(--muted)]">/month</span>
      </p>
      <div className="rounded-xl bg-[var(--surface-subtle)] px-3.5 py-3 text-sm">
        <p className="font-extrabold text-[var(--ink)]">
          {plan.includedMinutes.toLocaleString("en-US")} minutes included
        </p>
        <p className="text-[var(--muted)]">{formatTypicalCallsLine(plan.includedMinutes)}</p>
      </div>
      <p className="text-sm text-[var(--body)]">
        {waive ? (
          <>
            Setup <span className="line-through text-[var(--muted)]">{formatPlanCents(plan.setupFeeCents)}</span>{" "}
            <Pill tone="success">Waived</Pill>
          </>
        ) : (
          <>Setup {formatPlanCents(plan.setupFeeCents)} one time</>
        )}
      </p>
      <p className="text-sm text-[var(--muted)]">Billed monthly. Cancel anytime.</p>
    </aside>
  );
}
