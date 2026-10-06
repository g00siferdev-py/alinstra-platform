import { LeadForm } from "@/components/marketing/lead-form";
import { Pill } from "@/components/ui";
import { normalizePlanInterest, planInterestLabel } from "@/lib/marketing-plan-interest";
import { marketingMetadata } from "@/lib/marketing-seo";

export const dynamic = "force-dynamic";

export const metadata = marketingMetadata({
  title: "Get started",
  description:
    "Questions, Enterprise, or not sure which plan? Tell us about your business and we'll get back to you within one business day.",
  path: "/start",
});

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = Array.isArray(query.plan) ? query.plan[0] : query.plan;
  const planInterest = normalizePlanInterest(raw);

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-7 py-16">
      <h1 className="text-[40px] font-extrabold tracking-[-0.03em]">Get in touch.</h1>
      <p className="text-[var(--muted)]">
        Questions, Enterprise, or not sure which plan? Tell us about your business and we&apos;ll get back to you within
        one business day.
      </p>
      {planInterest ? (
        <Pill tone="info" className="w-fit">
          Plan: {planInterestLabel(planInterest)}
        </Pill>
      ) : null}
      <LeadForm planInterest={planInterest} />
    </main>
  );
}
