import {
  formatIncludedChanges,
  formatOveragePerMinute,
  formatPlanCents,
  publicPlans,
} from "@alinstra/db";
import Link from "next/link";

export const revalidate = 3600;

export default async function PricingPage() {
  const plans = await publicPlans();
  const recallSample = plans.find((plan) => plan.recallMonthlyCents > 0 || plan.recallPerBookingCents > 0);

  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-6 py-16">
      <div className="grid gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Simple plans. No per-call surprises.</h1>
        <p className="max-w-2xl text-[var(--muted)]">
          Every plan includes setup by our team, a dedicated local number (or use your own), instant message delivery, transcripts
          and recordings, and the owner portal.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="py-3 pr-4 font-medium text-[var(--muted)]" scope="col" />
              {plans.map((plan) => (
                <th key={plan.id} className="px-3 py-3 font-semibold text-[var(--ink)]" scope="col">
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
        <p className="text-[var(--ink)]">
          <strong className="font-semibold">Founding offer:</strong> setup fee waived for the first ten businesses.{" "}
          <Link href="/start">Start</Link>
        </p>
        <p className="max-w-3xl text-[var(--muted)]">
          Not sure which plan? Most single-location businesses that miss 5 to 15 calls a week fit Starter. A busy clinic or a
          company with after-hours emergencies usually wants Professional.
        </p>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Minutes count only while Ava is on the line. A typical message takes two to three minutes.
        </p>
      </div>

      <section className="grid gap-6 border-t border-[var(--line)] pt-10">
        <h2 className="text-2xl font-semibold tracking-tight">Add-ons</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-2">
            <h3 className="font-medium">Follow-up calls</h3>
            <p className="text-sm text-[var(--muted)]">
              Upload your recall list and Ava calls each customer when their service is due and books the next visit. Simple
              monthly tiers; you&apos;re never charged for calls that don&apos;t connect.
            </p>
            <p className="text-sm text-[var(--ink)]">
              {recallSample && (recallSample.recallMonthlyCents > 0 || recallSample.recallPerBookingCents > 0) ? (
                <>
                  From {formatPlanCents(recallSample.recallMonthlyCents)}/month
                  {recallSample.recallPerBookingCents > 0
                    ? ` plus ${formatPlanCents(recallSample.recallPerBookingCents)} per booking`
                    : ""}
                  .{" "}
                  <Link href="/start">Ask about pricing</Link>
                </>
              ) : (
                <Link href="/start">Ask about pricing</Link>
              )}
            </p>
          </div>
          <div className="grid gap-2">
            <h3 className="font-medium">Calendar booking</h3>
            <p className="text-sm text-[var(--muted)]">
              Direct scheduling into your calendar (Google Calendar first; practice management systems on request). Included on
              Professional and Premium once connected.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
