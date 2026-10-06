import { PlanCards } from "@/components/marketing/plan-cards";
import { Pill } from "@/components/ui";
import { ASSISTANT_NAME, FOUNDING_OFFER } from "@/lib/brand";
import { foundingWaivedPlanNames } from "@/lib/marketing-plans";
import { marketingMetadata } from "@/lib/marketing-seo";
import {
  formatIncludedChanges,
  formatOveragePerMinute,
  formatPlanCents,
  publicPlans,
} from "@alinstra/db";
import Link from "next/link";

export const metadata = marketingMetadata({
  title: "Pricing",
  description: "Simple plans. No per-call surprises. Setup, a dedicated number, messages, transcripts, and the owner portal.",
  path: "/pricing",
});

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default async function PricingPage() {
  const plans = await publicPlans();
  const waivedNames = foundingWaivedPlanNames(plans);

  return (
    <main className="px-7 py-16">
      <div className="mx-auto grid max-w-[1160px] gap-12">
        <div className="grid justify-items-center gap-3 text-center">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">PRICING</p>
          <h1 className="text-[40px] font-extrabold tracking-[-0.03em] md:text-5xl">
            Simple plans. No per-call surprises.
          </h1>
          <p className="max-w-3xl text-lg text-[var(--body)]">
            Start on your own with Solo, or let our team set you up. Minutes count only while {ASSISTANT_NAME} is on the
            line, and a typical message takes two to three minutes.
          </p>
          {FOUNDING_OFFER.active && waivedNames.length > 0 ? (
            <Pill tone="success" className="h-8 w-fit text-[13px]">
              Founding offer: setup fee waived on {joinNames(waivedNames)} for {FOUNDING_OFFER.audience}
            </Pill>
          ) : null}
        </div>

        <PlanCards plans={plans} />

        <section className="grid gap-6">
          <h2 className="text-[28px] font-extrabold tracking-[-0.02em]">Compare plans in detail.</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="col" />
                  {plans.map((plan) => (
                    <th key={plan.id} className="px-3 py-3 font-extrabold text-[var(--ink)]" scope="col">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="row">
                    Monthly
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-3 py-3">
                      {formatPlanCents(plan.monthlyPriceCents)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="row">
                    Included minutes
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-3 py-3">
                      {plan.includedMinutes.toLocaleString("en-US")}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="row">
                    Overage
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-3 py-3">
                      {formatOveragePerMinute(plan.overagePerMinuteCents)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="row">
                    Setup
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-3 py-3">
                      {formatPlanCents(plan.setupFeeCents)}
                      {plan.code === "solo" ? " (self-serve)" : ""}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="row">
                    Included changes/month
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-3 py-3">
                      {formatIncludedChanges(plan.includedChangesPerMonth)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid gap-3">
            {FOUNDING_OFFER.active && waivedNames.length > 0 ? (
              <p className="text-[var(--body)]">
                <strong className="font-extrabold text-[var(--ink)]">Founding offer:</strong> setup fee waived on{" "}
                {joinNames(waivedNames)} for the first ten businesses. Solo keeps its $99 setup.{" "}
                <Link href="/start">Start</Link>
              </p>
            ) : null}
            <p className="max-w-3xl text-[var(--muted)]">
              Not sure which plan? Just you and your truck? Solo. Most single-location businesses that miss 5 to 15 calls a
              week fit Starter. A busy clinic or a company with after-hours emergencies usually wants Professional.
            </p>
            <p className="max-w-3xl text-sm text-[var(--muted)]">
              Minutes count only while {ASSISTANT_NAME} is on the line. A typical message takes two to three minutes.
            </p>
          </div>
        </section>

        <section className="grid gap-6 border-t border-[var(--line)] pt-10">
          <h2 className="text-[28px] font-extrabold tracking-[-0.02em]">Add-ons</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid gap-2">
              <h3 className="font-extrabold">Follow-up calls</h3>
              <p className="text-sm text-[var(--muted)]">
                Upload your recall list and {ASSISTANT_NAME} calls each customer when their service is due and books the
                next visit. Simple monthly tiers; you&apos;re never charged for calls that don&apos;t connect.
              </p>
              <p className="text-sm text-[var(--ink)]">
                <Link href="/start">Ask about pricing →</Link>
              </p>
            </div>
            <div className="grid gap-2">
              <h3 className="font-extrabold">Calendar booking</h3>
              <p className="text-sm text-[var(--muted)]">
                Direct scheduling into your calendar (Google Calendar first; practice management systems on request).
                Included on Professional and Premium once connected.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
