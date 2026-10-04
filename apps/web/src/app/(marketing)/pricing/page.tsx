import { PRODUCT_NAME } from "@/lib/brand";
import Link from "next/link";

export const revalidate = 3600;

/** Part 2 replaces the static note with a live Plan table. */
export default function PricingPage() {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-6 py-16">
      <div className="grid gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Simple plans. No per-call surprises.</h1>
        <p className="max-w-2xl text-[var(--muted)]">
          Every plan includes setup by our team, a dedicated local number (or use your own), instant message delivery, transcripts
          and recordings, and the owner portal.
        </p>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Live pricing loads from the plan catalog in the next step of this release.{" "}
        <Link href="/start">Start</Link> to talk with us about {PRODUCT_NAME}.
      </p>
    </main>
  );
}
