import { ASSISTANT_NAME } from "@/lib/brand";
import Link from "next/link";

export const revalidate = 3600;

export default function IndustriesPage() {
  return (
    <main className="mx-auto grid max-w-5xl gap-12 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Industries</h1>

      <section className="grid max-w-3xl gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">HVAC and home services</h2>
        <p className="text-[var(--muted)]">
          Your techs are on roofs and in crawlspaces. {ASSISTANT_NAME} takes the &quot;my AC just died&quot; call at 9 p.m., gets the
          address and the problem to the on-call tech, or books the morning slot. Come fall, hand her your maintenance-plan list and
          she calls to schedule the furnace tune-up before the first cold snap.
        </p>
      </section>

      <section className="grid max-w-3xl gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Veterinary clinics</h2>
        <p className="text-[var(--muted)]">
          Front desk slammed, three on hold, the phone keeps ringing. {ASSISTANT_NAME} takes the refill request and the &quot;is this
          an emergency&quot; call, gives your after-hours instructions word for word, and never guesses on medical advice. And when a
          patient&apos;s rabies booster or flea refill comes due, give {ASSISTANT_NAME} the recall list and she calls the owner and
          books the visit, so that list stops being a sticky note.
        </p>
      </section>

      <section className="grid max-w-3xl gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">More coming.</h2>
        <p className="text-[var(--muted)]">
          Dental, med spa, chiropractic, and medical weight management are on the way with a HIPAA-ready tier.{" "}
          <Link href="/start">Tell us your industry</Link>
        </p>
      </section>
    </main>
  );
}
