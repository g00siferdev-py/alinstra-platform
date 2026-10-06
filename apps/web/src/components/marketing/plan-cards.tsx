import { btnPrimary, btnSecondary } from "@/components/marketing/button-classes";
import { Pill } from "@/components/ui";
import { FOUNDING_OFFER } from "@/lib/brand";
import {
  formatTypicalCallsLine,
  planChangesLine,
  planMarketingFor,
  planOverageLine,
} from "@/lib/marketing-plans";
import { formatPlanCents, type PublicPlan } from "@alinstra/db";
import { Building2, Check } from "lucide-react";
import Link from "next/link";

export function PlanCards({ plans }: { plans: PublicPlan[] }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 lg:items-stretch">
        {plans.map((plan) => {
          const meta = planMarketingFor(plan.code);
          const recommended = meta.recommended;
          const waive = FOUNDING_OFFER.active && meta.foundingWaiver;
          const bullets = [
            ...(meta.everythingIn ? [`Everything in ${meta.everythingIn}`] : []),
            ...meta.staticFeatures,
            planChangesLine(plan.includedChangesPerMonth),
            planOverageLine(plan, plans),
          ];
          return (
            <article
              key={plan.id}
              className={`relative flex flex-col gap-4 rounded-[20px] bg-[var(--surface)] px-5 py-6 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_8px_24px_rgba(15,27,45,0.06)] ${
                recommended
                  ? "border-2 border-[var(--primary)] lg:-translate-y-3 lg:shadow-[0_1px_2px_rgba(15,27,45,0.06),0_24px_48px_rgba(36,83,214,0.18)]"
                  : "border border-[var(--line)]"
              }`}
            >
              {recommended ? (
                <Pill
                  tone="none"
                  className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[var(--primary)] text-white shadow-[0_0_0_4px_var(--btn-halo)]"
                >
                  Recommended
                </Pill>
              ) : null}
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-extrabold text-[var(--ink)]">{plan.name}</h3>
                  {meta.badge ? <Pill tone="warning">{meta.badge}</Pill> : null}
                </div>
                <p className="min-h-[2.6rem] text-sm text-[var(--muted)]">{meta.tagline}</p>
              </div>
              <div>
                <p className="text-[44px] font-extrabold tracking-tight text-[var(--ink)] leading-none">
                  {formatPlanCents(plan.monthlyPriceCents)}
                  <span className="text-[15px] font-bold text-[var(--muted)]">/month</span>
                </p>
              </div>
              <div
                className={`rounded-xl px-3.5 py-3 text-sm ${
                  recommended ? "bg-[var(--primary-soft)]" : "bg-[var(--surface-subtle)]"
                }`}
              >
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
              <Link
                href={`/start?plan=${plan.code}`}
                className={`${recommended ? btnPrimary : btnSecondary} w-full justify-center`}
              >
                {meta.ctaLabel}
              </Link>
              <div className="h-px bg-[var(--divider)]" />
              <ul className="grid gap-2.5">
                {bullets.map((bullet) => {
                  const everything = meta.everythingIn && bullet === `Everything in ${meta.everythingIn}`;
                  return (
                    <li key={bullet} className="flex gap-2.5 text-sm text-[var(--body)]">
                      <Check
                        className={`mt-0.5 h-4 w-4 shrink-0 ${recommended ? "text-[var(--primary)]" : "text-[var(--success-text)]"}`}
                        aria-hidden="true"
                      />
                      <span className={everything ? "font-bold text-[var(--ink)]" : undefined}>{bullet}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 rounded-[20px] bg-[var(--ink)] px-6 py-5 text-white sm:flex-row sm:items-center">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-extrabold">Enterprise</p>
            <Pill tone="none" className="bg-white/12 text-[#DCE6FB]">
              Custom pricing
            </Pill>
          </div>
          <p className="text-sm text-[#C9D3E6]">
            Several locations, heavy call volume, or special requirements? We&apos;ll build a plan around you.
          </p>
        </div>
        <Link
          href="/start?plan=enterprise"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-[10px] bg-white px-4 text-sm font-extrabold text-[var(--primary-text)] no-underline"
        >
          Contact us
        </Link>
      </div>
    </div>
  );
}
