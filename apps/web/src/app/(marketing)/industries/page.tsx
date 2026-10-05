import { MARKETING_AUDIENCE_COMING, MARKETING_AUDIENCES } from "@/lib/marketing-audiences";
import { marketingMetadata } from "@/lib/marketing-seo";
import Link from "next/link";

export const metadata = marketingMetadata({
  title: "Who it's for",
  description:
    "Any business that lives on the phone — HVAC, vet clinics, salons, auto shops, contractors, law offices, property managers, restaurants, and more.",
  path: "/industries",
});

export default function IndustriesPage() {
  const cards = [...MARKETING_AUDIENCES, MARKETING_AUDIENCE_COMING];
  return (
    <main className="mx-auto grid max-w-[1160px] gap-10 px-7 py-16">
      <div className="grid gap-3">
        <h1 className="text-[40px] font-extrabold tracking-[-0.03em] md:text-5xl">Who it&apos;s for</h1>
        <p className="max-w-2xl text-[var(--muted)]">
          Any business that lives on the phone. If a missed call costs you a customer, Ava&apos;s for you.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.slug} className="grid gap-2 rounded-[20px] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            {/* href reserved for future /for/[slug] landing pages */}
            <h2 className="text-lg font-extrabold tracking-tight">
              <span data-audience-slug={card.slug}>{card.title}</span>
            </h2>
            <p className="text-sm text-[var(--muted)]">{card.blurb}</p>
          </li>
        ))}
      </ul>

      <p className="text-sm text-[var(--muted)]">
        Don&apos;t see your industry? <Link href="/start">Tell us</Link> — we&apos;ll still set you up.
      </p>
    </main>
  );
}
