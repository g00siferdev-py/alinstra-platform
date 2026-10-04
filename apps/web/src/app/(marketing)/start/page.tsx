export const revalidate = 3600;

/** Part 3 replaces this shell with the lead form. */
export default function StartPage() {
  return (
    <main className="mx-auto grid max-w-xl gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Let&apos;s get you set up.</h1>
      <p className="text-[var(--muted)]">
        Tell us about your business and we&apos;ll call you within one business day to walk through setup.
      </p>
      <p className="text-sm text-[var(--muted)]">The lead form lands in the next step of this release.</p>
    </main>
  );
}
