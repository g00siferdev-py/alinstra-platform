import { LeadForm } from "@/components/marketing/lead-form";
import { marketingMetadata } from "@/lib/marketing-seo";

export const dynamic = "force-dynamic";

export const metadata = marketingMetadata({
  title: "Get started",
  description: "Let's get you set up. Tell us about your business and we'll call within one business day.",
  path: "/start",
});

export default function StartPage() {
  return (
    <main className="mx-auto grid max-w-xl gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Let&apos;s get you set up.</h1>
      <p className="text-[var(--muted)]">
        Tell us about your business and we&apos;ll call you within one business day to walk through setup.
      </p>
      <LeadForm />
    </main>
  );
}
