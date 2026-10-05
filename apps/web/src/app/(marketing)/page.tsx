import { btnPrimary, btnSecondary } from "@/components/marketing/button-classes";
import { Pill } from "@/components/ui";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/brand";
import { marketingPhoneDisplay, marketingTelHref } from "@/lib/marketing-phone";
import { HOME_DESCRIPTION, marketingMetadata } from "@/lib/marketing-seo";
import { publicSiteConfig } from "@alinstra/db";
import Link from "next/link";

export const metadata = marketingMetadata({
  title: "Alinstra",
  description: HOME_DESCRIPTION,
  path: "/",
});

const OUTCOMES = [
  { title: "New message", detail: "Caller left a callback and a short note.", tone: "info" as const },
  { title: "Appointment request", detail: "Morning slot requested for a service call.", tone: "success" as const },
  { title: "Follow-up booked", detail: "Recall list customer confirmed next visit.", tone: "live" as const },
];

const INDUSTRIES = ["HVAC", "Veterinary", "Home services", "Salons", "Auto shops", "Offices"];

export default async function MarketingHomePage() {
  const site = await publicSiteConfig();
  const display = marketingPhoneDisplay(site.phone);
  const tel = marketingTelHref(site.phone);

  return (
    <main className="bg-[var(--surface)]">
      <section className="mx-auto max-w-[1160px] px-7 py-10 md:py-14">
        <div className="grid gap-10 rounded-[32px] bg-[#F3F6FA] px-6 py-10 md:grid-cols-[1.15fr_0.85fr] md:items-center md:px-12 md:py-14">
          <div className="grid gap-6">
            <Pill tone="success" className="w-fit">
              Built in Morristown, Tennessee
            </Pill>
            <h1 className="max-w-xl text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--ink)] md:text-[58px]">
              The calls you miss are the ones that mattered.
            </h1>
            <p className="max-w-xl text-lg text-[var(--body)]">
              {PRODUCT_NAME} answers when your team can&apos;t: after hours, over lunch, and when every line is busy. It
              takes the message, books the request, and sends it to you in seconds.
            </p>
            <div className="flex flex-wrap gap-3">
              {tel && display ? (
                <a className={btnPrimary} href={tel}>
                  Call {ASSISTANT_NAME} now: {display}
                </a>
              ) : (
                <Link className={btnPrimary} href="/start">
                  Get started
                </Link>
              )}
              <Link className={btnSecondary} href="/pricing">
                See pricing
              </Link>
            </div>
            <p className="max-w-xl text-sm text-[var(--muted)]">
              A backup receptionist, not a replacement. Your people answer first. {ASSISTANT_NAME} catches what they
              can&apos;t.
            </p>
          </div>

          <div className="grid gap-3">
            {OUTCOMES.map((item) => (
              <article
                key={item.title}
                className="rounded-[20px] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-card)]"
              >
                <Pill tone={item.tone} className="mb-2">
                  {item.title}
                </Pill>
                <p className="text-sm text-[var(--body)]">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-7 pb-6">
        <div className="flex flex-wrap gap-2">
          {INDUSTRIES.map((label) => (
            <Pill key={label} tone="neutral">
              {label}
            </Pill>
          ))}
          <Link className="text-sm font-bold text-[var(--primary-text)]" href="/industries">
            See who it&apos;s for
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-7 py-12">
        <h2 className="mb-8 text-[28px] font-extrabold tracking-[-0.02em]">How it works</h2>
        <ol className="grid gap-6 md:grid-cols-3">
          <li className="grid gap-2">
            <p className="text-sm font-extrabold text-[var(--primary)]">1</p>
            <h3 className="font-extrabold">Tell us about your business.</h3>
            <p className="text-sm text-[var(--muted)]">
              Hours, services, who to transfer to, what to say when you&apos;re closed. Takes about twenty minutes.
            </p>
          </li>
          <li className="grid gap-2">
            <p className="text-sm font-extrabold text-[var(--primary)]">2</p>
            <h3 className="font-extrabold">Forward your missed calls.</h3>
            <p className="text-sm text-[var(--muted)]">
              Keep your number. Your carrier sends unanswered calls to {ASSISTANT_NAME}.
            </p>
          </li>
          <li className="grid gap-2">
            <p className="text-sm font-extrabold text-[var(--primary)]">3</p>
            <h3 className="font-extrabold">Get every message instantly.</h3>
            <p className="text-sm text-[var(--muted)]">
              Caller, callback number, what they need, by email or text the moment the call ends.
            </p>
          </li>
        </ol>
      </section>

      <section className="mx-auto max-w-[1160px] px-7 py-12">
        <h2 className="mb-4 text-[28px] font-extrabold tracking-[-0.02em]">
          {ASSISTANT_NAME} calls them back, too.
        </h2>
        <p className="max-w-3xl text-[var(--body)]">
          Reorders. Annual checkups. Tune-ups. Membership renewals. Every business with a repeat schedule loses revenue
          to customers who simply forgot. Give {ASSISTANT_NAME} your recall list and she calls when it&apos;s due,
          offers the next appointment, and books it. One reminder call that lands is worth the whole month.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-[var(--muted)] italic">
          Available as the Follow-up add-on. Customers must have agreed to be contacted by phone.
        </p>
      </section>

      <section className="mx-auto max-w-[1160px] px-7 py-12">
        <h2 className="mb-6 text-[28px] font-extrabold tracking-[-0.02em]">What {ASSISTANT_NAME} does</h2>
        <ul className="grid max-w-3xl gap-3 text-[var(--body)]">
          <li>Answers in two rings, 24 hours a day</li>
          <li>
            Takes messages and schedules appointments: as a request your office confirms, or booked straight into your
            calendar when it&apos;s connected
          </li>
          <li>Makes follow-up calls from your recall list, so the customer books the next visit before they forget</li>
          <li>Transfers urgent calls to a real person during business hours</li>
          <li>Knows your hours, services, and policies, and says &quot;I don&apos;t know&quot; instead of guessing</li>
          <li>Never shares a staff member&apos;s cell number, and tells callers the truth when asked if she&apos;s a person</li>
        </ul>
      </section>

      <section className="mx-auto max-w-[1160px] px-7 py-12 pb-20">
        <h2 className="mb-8 text-[28px] font-extrabold tracking-[-0.02em]">Why owners pick it</h2>
        <div className="grid gap-8 md:grid-cols-3">
          <div className="grid gap-2">
            <h3 className="font-extrabold">You hear the real thing before you buy.</h3>
            <p className="text-sm text-[var(--muted)]">
              Call the number at the top of this page. That&apos;s {ASSISTANT_NAME}, answering for us.
            </p>
          </div>
          <div className="grid gap-2">
            <h3 className="font-extrabold">Transcripts and recordings, your eyes only.</h3>
            <p className="text-sm text-[var(--muted)]">
              Encrypted, kept 90 days by default, deleted on your schedule. Staff see them only if you say so.
            </p>
          </div>
          <div className="grid gap-2">
            <h3 className="font-extrabold">Built in Morristown, Tennessee.</h3>
            <p className="text-sm text-[var(--muted)]">
              Set up by a person, reviewed before it goes live, and you can reach us.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
