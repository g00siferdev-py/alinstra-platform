import { HeroPhone } from "@/components/marketing/hero-phone";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/brand";
import { marketingPhoneDisplay, marketingTelHref } from "@/lib/marketing-phone";
import { publicSiteConfig } from "@alinstra/db";
import Link from "next/link";

export const revalidate = 3600;

export default async function MarketingHomePage() {
  const site = await publicSiteConfig();
  const display = marketingPhoneDisplay(site.phone);
  const tel = marketingTelHref(site.phone);

  return (
    <main>
      <section className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-[1.2fr_0.8fr] md:items-center md:py-24">
        <div className="grid gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink)] md:text-5xl">
            The calls you miss are the ones that mattered.
          </h1>
          <p className="max-w-xl text-lg text-[var(--muted)]">
            {PRODUCT_NAME} answers when your team can&apos;t: after hours, over lunch, and when every line is busy. It takes the
            message, books the request, and sends it to you in seconds.
          </p>
          <div className="flex flex-wrap gap-3">
            {tel && display ? (
              <a
                className="inline-block rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-ink)] no-underline"
                href={tel}
              >
                Call {ASSISTANT_NAME} now: {display}
              </a>
            ) : (
              <Link
                className="inline-block rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-ink)] no-underline"
                href="/start"
              >
                Get started
              </Link>
            )}
            <Link
              className="inline-block rounded-md border border-[var(--line)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] no-underline"
              href="/pricing"
            >
              See pricing
            </Link>
          </div>
          <p className="max-w-xl text-sm text-[var(--muted)]">
            A backup receptionist, not a replacement. Your people answer first. {ASSISTANT_NAME} catches what they can&apos;t.
          </p>
        </div>
        <HeroPhone className="mx-auto h-44 w-full max-w-md text-[var(--ink)]" />
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            <li className="grid gap-2">
              <p className="text-sm font-medium text-[var(--accent)]">1</p>
              <h3 className="font-medium">Tell us about your business.</h3>
              <p className="text-sm text-[var(--muted)]">
                Hours, services, who to transfer to, what to say when you&apos;re closed. Takes about twenty minutes.
              </p>
            </li>
            <li className="grid gap-2">
              <p className="text-sm font-medium text-[var(--accent)]">2</p>
              <h3 className="font-medium">Forward your missed calls.</h3>
              <p className="text-sm text-[var(--muted)]">Keep your number. Your carrier sends unanswered calls to {ASSISTANT_NAME}.</p>
            </li>
            <li className="grid gap-2">
              <p className="text-sm font-medium text-[var(--accent)]">3</p>
              <h3 className="font-medium">Get every message instantly.</h3>
              <p className="text-sm text-[var(--muted)]">
                Caller, callback number, what they need, by email or text the moment the call ends.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">{ASSISTANT_NAME} calls them back, too.</h2>
          <p className="max-w-3xl text-[var(--muted)]">
            Flea and tick refills. Annual vaccines. Grooming. Furnace tune-ups. Every business with a repeat schedule loses revenue
            to customers who simply forgot. Give {ASSISTANT_NAME} your recall list and she calls when it&apos;s due, offers the next
            appointment, and books it. One reminder call that lands is worth the whole month.
          </p>
          <p className="max-w-3xl text-sm text-[var(--muted)] italic">
            Available as the Follow-up add-on. Customers must have agreed to be contacted by phone.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">What {ASSISTANT_NAME} does</h2>
          <ul className="grid max-w-3xl gap-3 text-[var(--muted)]">
            <li>Answers in two rings, 24 hours a day</li>
            <li>
              Takes messages and schedules appointments: as a request your office confirms, or booked straight into your calendar
              when it&apos;s connected
            </li>
            <li>Makes follow-up calls from your recall list, so the customer books the next visit before they forget</li>
            <li>Transfers urgent calls to a real person during business hours</li>
            <li>Knows your hours, services, and policies, and says &quot;I don&apos;t know&quot; instead of guessing</li>
            <li>Never shares a staff member&apos;s cell number, and tells callers the truth when asked if she&apos;s a person</li>
          </ul>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Why owners pick it</h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="grid gap-2">
              <h3 className="font-medium">You hear the real thing before you buy.</h3>
              <p className="text-sm text-[var(--muted)]">Call the number at the top of this page. That&apos;s {ASSISTANT_NAME}, answering for us.</p>
            </div>
            <div className="grid gap-2">
              <h3 className="font-medium">Transcripts and recordings, your eyes only.</h3>
              <p className="text-sm text-[var(--muted)]">
                Encrypted, kept 90 days by default, deleted on your schedule. Staff see them only if you say so.
              </p>
            </div>
            <div className="grid gap-2">
              <h3 className="font-medium">Built in Morristown, Tennessee.</h3>
              <p className="text-sm text-[var(--muted)]">Set up by a person, reviewed before it goes live, and you can reach us.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
