import { PRODUCT_NAME } from "@/lib/brand";

export const revalidate = 3600;

export default function LegalPage() {
  return (
    <main className="mx-auto grid max-w-3xl gap-12 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Legal</h1>

      <section id="ai-disclosure" className="grid gap-3 scroll-mt-8">
        <h2 className="text-2xl font-semibold tracking-tight">AI disclosure</h2>
        <p className="text-[var(--muted)]">
          Calls to {PRODUCT_NAME} numbers are answered by an AI assistant. If a caller asks whether they&apos;re speaking with a
          person, the assistant says it&apos;s a virtual assistant.
        </p>
      </section>

      <section id="recording" className="grid gap-3 scroll-mt-8">
        <h2 className="text-2xl font-semibold tracking-tight">Recording</h2>
        <p className="text-[var(--muted)]">
          Calls may be recorded for message accuracy and quality. The business you called controls how long recordings are kept.
        </p>
      </section>

      <section id="follow-up" className="grid gap-3 scroll-mt-8">
        <h2 className="text-2xl font-semibold tracking-tight">Follow-up calls</h2>
        <p className="text-[var(--muted)]">
          Businesses using the Follow-up add-on attest that each customer called has given prior express consent to be contacted by
          phone.
        </p>
      </section>

      <section id="privacy" className="grid gap-3 scroll-mt-8">
        <h2 className="text-2xl font-semibold tracking-tight">Privacy</h2>
        <p className="text-[var(--muted)]">Coming soon.</p>
      </section>

      <section id="terms" className="grid gap-3 scroll-mt-8">
        <h2 className="text-2xl font-semibold tracking-tight">Terms</h2>
        <p className="text-[var(--muted)]">Coming soon.</p>
      </section>
    </main>
  );
}
