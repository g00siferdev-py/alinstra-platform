import { btnPrimary, btnSecondary } from "@/components/marketing/button-classes";
import { MarketingWaveform } from "@/components/marketing/marketing-waveform";
import { PlanCards } from "@/components/marketing/plan-cards";
import { IconTile, Pill, WaveformMark } from "@/components/ui";
import { ASSISTANT_NAME, FOUNDING_OFFER, PRODUCT_NAME } from "@/lib/brand";
import { cheapestPlan, foundingWaivedPlanNames } from "@/lib/marketing-plans";
import { isTollFree, marketingPhoneDisplay, marketingTelHref } from "@/lib/marketing-phone";
import { HOME_DESCRIPTION, marketingMetadata } from "@/lib/marketing-seo";
import { formatPlanCents, publicPlans, publicSiteConfig } from "@alinstra/db";
import {
  ArrowLeftRight,
  BookOpen,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  Headphones,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

export const metadata = marketingMetadata({
  title: "Alinstra",
  description: HOME_DESCRIPTION,
  path: "/",
});

const INDUSTRIES = ["HVAC", "Veterinary", "Home services", "Salons", "Auto shops", "Offices"];
const WAVE_SM = [10, 16, 12, 18, 9, 14, 11];
const WAVE_LG = [14, 22, 18, 28, 16, 24, 20, 30, 18, 26, 15, 22, 28, 17, 24, 20, 30, 16, 22, 18];
const WAVE_MINI = [8, 12, 7, 11];

function CallCta({
  phone,
  prefix,
  className,
}: {
  phone: string | null;
  prefix: string;
  className: string;
}) {
  const display = marketingPhoneDisplay(phone);
  const tel = marketingTelHref(phone);
  if (tel && display) {
    return (
      <a className={className} href={tel}>
        <Phone className="h-4 w-4" aria-hidden="true" />
        {prefix}: {display}
      </a>
    );
  }
  return (
    <Link className={className} href="/start">
      Get started
    </Link>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default async function MarketingHomePage() {
  const [site, plans] = await Promise.all([publicSiteConfig(), publicPlans()]);
  const phone = site.phone;
  const email = site.email;
  const display = marketingPhoneDisplay(phone);
  const tel = marketingTelHref(phone);
  const cheapest = cheapestPlan(plans);
  const waivedNames = foundingWaivedPlanNames(plans);

  return (
    <main className="bg-white">
      {/* Hero */}
      <section className="px-7 pt-7">
        <div className="mx-auto max-w-[1160px] rounded-[32px] bg-[#F3F6FA] px-6 pb-28 pt-12 md:px-12 md:pt-16">
          <div className="grid items-center gap-12 md:grid-cols-[1.12fr_0.88fr]">
            <div className="grid gap-6">
              <Pill tone="success" className="w-fit">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--success-text)]" />
                Built in Morristown, Tennessee
              </Pill>
              <h1 className="max-w-xl text-[40px] font-extrabold leading-[1.05] tracking-[-0.035em] text-[var(--ink)] md:text-[58px]">
                The calls you miss are the ones that mattered.
              </h1>
              <p className="max-w-xl text-lg text-[var(--body)]">
                {PRODUCT_NAME} answers when your team can&apos;t: after hours, over lunch, and when every line is busy. It
                takes the message, books the request, and sends it to you in seconds.
              </p>
              <div className="flex flex-wrap gap-3.5">
                <CallCta phone={phone} prefix="Call Ava now" className={btnPrimary} />
                <Link className={btnSecondary} href="#pricing">
                  See pricing
                </Link>
              </div>
              <p className="max-w-xl text-sm text-[var(--muted)]">
                A backup receptionist, not a replacement. Your people answer first. {ASSISTANT_NAME} catches what they
                can&apos;t.
              </p>
            </div>

            <div className="grid gap-3.5">
              <div className="ml-auto inline-flex items-center gap-3 rounded-full border border-[var(--live-border)] bg-[var(--live-soft)] px-4 py-2.5 text-[13px] font-bold text-[var(--live-text)]">
                <span className="live-dot" />
                {ASSISTANT_NAME} is on a call
                <MarketingWaveform heights={WAVE_SM} size="sm" />
                <span className="tabular-nums">0:42</span>
              </div>
              <article className="flex gap-3.5 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_10px_28px_rgba(15,27,45,0.10)]">
                <IconTile soft="var(--success-soft)">
                  <MessageSquare className="h-5 w-5 text-[var(--success-text)]" />
                </IconTile>
                <div className="min-w-0 flex-1 grid gap-1">
                  <div className="flex justify-between gap-2">
                    <p className="font-extrabold text-[var(--ink)]">New message from {ASSISTANT_NAME}</p>
                    <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">9:16 PM</span>
                  </div>
                  <p className="text-sm text-[var(--body)]">
                    Maria G. · AC stopped cooling, 88° inside · call back (423) 555-0198
                  </p>
                </div>
              </article>
              <article className="flex gap-3.5 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_10px_28px_rgba(15,27,45,0.10)] md:ml-8">
                <IconTile soft="var(--primary-soft)">
                  <Calendar className="h-5 w-5 text-[var(--primary-text)]" />
                </IconTile>
                <div className="min-w-0 flex-1 grid gap-1">
                  <div className="flex justify-between gap-2">
                    <p className="font-extrabold text-[var(--ink)]">Appointment request</p>
                    <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">7:42 PM</span>
                  </div>
                  <p className="text-sm text-[var(--body)]">Biscuit&apos;s rabies booster · prefers Thursday morning</p>
                </div>
              </article>
              <article className="flex gap-3.5 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_10px_28px_rgba(15,27,45,0.10)]">
                <IconTile soft="var(--warning-pill)">
                  <RefreshCw className="h-5 w-5 text-[var(--warning-text)]" />
                </IconTile>
                <div className="min-w-0 flex-1 grid gap-1">
                  <div className="flex justify-between gap-2">
                    <p className="font-extrabold text-[var(--ink)]">Follow-up booked</p>
                    <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">Today</span>
                  </div>
                  <p className="text-sm text-[var(--body)]">
                    {ASSISTANT_NAME} called the Hendersons from your recall list. Furnace tune-up, Oct 14.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* Stat bar */}
      <section className="px-7">
        <div className="relative z-10 mx-auto mt-[-52px] grid max-w-[1040px] grid-cols-2 overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,27,45,0.06),0_16px_40px_rgba(15,27,45,0.10)] md:grid-cols-4">
          {[
            { value: "2 rings", label: `That's how fast ${ASSISTANT_NAME} picks up`, color: "text-[var(--primary)]" },
            { value: "24/7", label: "Nights, weekends, and holidays", color: "text-[var(--primary)]" },
            { value: "20 min", label: "One setup chat. No forms.", color: "text-[var(--primary)]" },
            {
              value: cheapest ? `${formatPlanCents(cheapest.monthlyPriceCents)}/mo` : "—",
              label: cheapest ? `Plans start with ${cheapest.name}` : "Plans coming soon",
              color: "text-[var(--success-text)]",
            },
          ].map((cell, index, cells) => (
            <div
              key={cell.value}
              className={`flex flex-col gap-1 border-[var(--divider)] px-5 py-6 ${
                index % 2 === 0 ? "border-r" : ""
              } md:border-r ${index === cells.length - 1 ? "md:border-r-0" : ""}`}
            >
              <span className={`text-[28px] font-extrabold tracking-tight ${cell.color}`}>{cell.value}</span>
              <span className="text-sm font-semibold text-[var(--muted)]">{cell.label}</span>
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-center gap-2.5 pt-9">
          <span className="mr-1.5 text-sm font-bold text-[var(--muted)]">
            Made for any business that runs on the phone:
          </span>
          {INDUSTRIES.map((label) => (
            <span
              key={label}
              className="inline-flex h-9 items-center rounded-full border border-[var(--line)] bg-white px-3.5 text-sm font-semibold text-[var(--body)]"
            >
              {label}
            </span>
          ))}
          <Link className="ml-1.5 text-sm font-bold text-[var(--primary-text)] no-underline" href="/industries">
            See who it&apos;s for →
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="px-7 py-20">
        <div className="mx-auto max-w-[1160px]">
        <div className="mb-11 grid justify-items-center gap-3 text-center">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">HOW IT WORKS</p>
          <h2 className="text-[38px] font-extrabold tracking-[-0.028em] text-[var(--ink)]">Live in three simple steps.</h2>
        </div>
        <ol className="grid gap-6 md:grid-cols-3">
          <li className="flex flex-col gap-3.5 rounded-[20px] border border-[var(--line)] p-6">
            <div className="flex items-center justify-between">
              <IconTile soft="var(--primary-soft)">
                <MessageSquare className="h-5 w-5 text-[var(--primary-text)]" />
              </IconTile>
              <Pill tone="neutral">Step 1</Pill>
            </div>
            <h3 className="text-lg font-extrabold">Tell us about your business.</h3>
            <p className="text-sm text-[var(--muted)]">
              Hours, services, who to transfer to, what to say when you&apos;re closed. Takes about twenty minutes.
            </p>
            <div className="mt-auto grid gap-2 rounded-[14px] bg-[var(--surface-subtle)] p-3.5">
              <p className="max-w-[85%] rounded-xl rounded-bl-sm border border-[var(--line)] bg-white px-3 py-2 text-[13px]">
                What are your hours on Saturday?
              </p>
              <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-[var(--primary)] px-3 py-2 text-[13px] text-white">
                9 to 1. Closed Sundays.
              </p>
            </div>
          </li>
          <li className="flex flex-col gap-3.5 rounded-[20px] border border-[var(--line)] p-6">
            <div className="flex items-center justify-between">
              <IconTile soft="var(--primary-soft)">
                <Phone className="h-5 w-5 text-[var(--primary-text)]" />
              </IconTile>
              <Pill tone="neutral">Step 2</Pill>
            </div>
            <h3 className="text-lg font-extrabold">Forward your missed calls.</h3>
            <p className="text-sm text-[var(--muted)]">
              Keep your number. Your carrier sends the calls you can&apos;t pick up to {ASSISTANT_NAME}.
            </p>
            <div className="mt-auto flex flex-wrap items-center justify-center gap-2 rounded-[14px] bg-[var(--surface-subtle)] p-3.5 text-[13px] font-semibold">
              <span className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5">(423) 555-0100</span>
              <span className="text-[var(--muted)]">→</span>
              <span className="rounded-lg bg-[var(--live-soft)] px-2.5 py-1.5 text-[var(--live-text)]">
                {ASSISTANT_NAME} answers
              </span>
            </div>
          </li>
          <li className="flex flex-col gap-3.5 rounded-[20px] border border-[var(--line)] p-6">
            <div className="flex items-center justify-between">
              <IconTile soft="var(--primary-soft)">
                <Mail className="h-5 w-5 text-[var(--primary-text)]" />
              </IconTile>
              <Pill tone="neutral">Step 3</Pill>
            </div>
            <h3 className="text-lg font-extrabold">Get every message instantly.</h3>
            <p className="text-sm text-[var(--muted)]">
              Caller, callback number, and what they need, in your email the moment the call ends.
            </p>
            <div className="mt-auto rounded-[14px] bg-[var(--surface-subtle)] p-3.5 text-[13px]">
              <p className="font-bold text-[var(--ink)]">New message: Maria G.</p>
              <p className="text-[var(--body)]">AC stopped cooling · call back (423) 555-0198 · just now</p>
            </div>
          </li>
        </ol>
        </div>
      </section>

      {/* What Ava does */}
      <section className="bg-[#F3F6FA] px-7 py-20">
        <div className="mx-auto grid max-w-[1160px] gap-10">
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div className="grid gap-2">
              <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">WHAT AVA DOES</p>
              <h2 className="text-[38px] font-extrabold tracking-[-0.028em] text-[var(--ink)]">
                Everything a great front desk does, around the clock.
              </h2>
            </div>
            <p className="text-lg text-[var(--body)]">
              She learns your business from one setup chat, then handles the calls your team can&apos;t get to.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Answers in two rings",
                body: "24 hours a day, including nights, weekends, and holidays.",
                soft: "var(--primary-soft)",
                icon: <Phone className="h-5 w-5 text-[var(--primary-text)]" />,
              },
              {
                title: "Takes the message",
                body: "Name, callback number, and what they need, written up clearly and sent to you.",
                soft: "var(--success-soft)",
                icon: <MessageSquare className="h-5 w-5 text-[var(--success-text)]" />,
              },
              {
                title: "Schedules appointments",
                body: "As a request your office confirms, or booked straight into your calendar when it's connected.",
                soft: "var(--purple-soft)",
                icon: <Calendar className="h-5 w-5 text-[var(--purple-text)]" />,
              },
              {
                title: "Makes follow-up calls",
                body: "Calls customers from your recall list so they book the next visit before they forget.",
                soft: "var(--warning-pill)",
                icon: <RefreshCw className="h-5 w-5 text-[var(--warning-text)]" />,
                addon: true,
              },
              {
                title: "Transfers urgent calls",
                body: "Gets the emergency to a real person during business hours, without ever giving out a staff member's cell number.",
                soft: "var(--live-soft)",
                icon: <ArrowLeftRight className="h-5 w-5 text-[var(--live-text)]" />,
              },
              {
                title: "Knows your business",
                body: 'Your hours, services, and policies. She says "I don\'t know" instead of guessing, and tells callers the truth if they ask whether she\'s a person.',
                soft: "var(--neutral-soft)",
                icon: <BookOpen className="h-5 w-5 text-[var(--ink)]" />,
              },
            ].map((card) => (
              <article key={card.title} className="grid gap-3 rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_8px_24px_rgba(15,27,45,0.06)]">
                <div className="flex items-center justify-between gap-2">
                  <IconTile soft={card.soft}>{card.icon}</IconTile>
                  {card.addon ? <Pill tone="warning">Add-on</Pill> : null}
                </div>
                <h3 className="text-lg font-extrabold">{card.title}</h3>
                <p className="text-sm text-[var(--muted)]">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Hear Ava */}
      {tel && display ? (
        <section className="px-7 py-16">
          <div className="mx-auto max-w-[1160px]">
          <div className="grid gap-10 rounded-[28px] border border-[var(--live-border)] bg-[var(--live-soft)] px-6 py-10 md:grid-cols-2 md:px-10">
            <div className="grid gap-4 content-start">
              <div className="flex items-center gap-2 text-[13px] font-extrabold tracking-[0.08em] text-[var(--live-text)]">
                <span className="live-dot" />
                TRY HER RIGHT NOW
              </div>
              <h2 className="text-[38px] font-extrabold tracking-[-0.028em] text-[var(--ink)]">
                Hear {ASSISTANT_NAME} for yourself.
              </h2>
              <p className="text-[var(--body)]">
                Call our line. That&apos;s {ASSISTANT_NAME}, answering for Alinstra. Ask her what you&apos;d ask your own
                receptionist, then picture her answering for you.
              </p>
              <MarketingWaveform heights={WAVE_LG} size="lg" />
              <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-4">
                <a className={`${btnPrimary} w-fit`} href={tel}>
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call {display}
                </a>
                <p className="text-sm font-semibold text-[var(--live-text)]">
                  {isTollFree(phone) ? "Toll-free · " : ""}about two minutes
                </p>
              </div>
            </div>
            <div className="rounded-[20px] bg-white p-5 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_18px_40px_rgba(14,110,92,0.14)]">
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="font-extrabold">Example call</p>
                <Pill tone="live">
                  {ASSISTANT_NAME} · 0:58
                </Pill>
              </div>
              <ol className="grid gap-3">
                {[
                  { role: "ava", text: `Thanks for calling Alinstra, this is ${ASSISTANT_NAME}. How can I help?` },
                  { role: "caller", text: "Can you book appointments for my clinic?" },
                  {
                    role: "ava",
                    text: "Yes. I can take the request for your office to confirm, or book it straight into your calendar once it's connected.",
                  },
                  { role: "caller", text: "And if it's an emergency?" },
                  {
                    role: "ava",
                    text: "During business hours I'll transfer them to someone on your team right away.",
                  },
                ].map((turn, index) => (
                  <li key={index} className={`flex ${turn.role === "ava" ? "justify-start" : "justify-end"}`}>
                    <div className={`flex max-w-[90%] items-end gap-2 ${turn.role === "caller" ? "flex-row-reverse" : ""}`}>
                      {turn.role === "ava" ? (
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--live-strong)] text-xs font-extrabold text-white">
                          A
                        </span>
                      ) : null}
                      <p
                        className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                          turn.role === "ava" ? "bg-[#EAF7F3] text-[var(--ink)]" : "bg-[var(--primary)] text-white"
                        }`}
                      >
                        {turn.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          </div>
        </section>
      ) : null}

      {/* Pricing */}
      <section id="pricing" className="px-7 py-16">
        <div className="mx-auto max-w-[1160px]">
        <div className="mb-8 grid justify-items-center gap-3 text-center">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">PRICING</p>
          <h2 className="text-[38px] font-extrabold tracking-[-0.028em]">Simple plans. No per-call surprises.</h2>
          <p className="max-w-3xl text-lg text-[var(--body)]">
            Start on your own with Solo, or let our team set you up. Minutes count only while {ASSISTANT_NAME} is on the
            line, and a typical message takes two to three minutes.
          </p>
          {FOUNDING_OFFER.active && waivedNames.length > 0 ? (
            <Pill tone="success" className="h-8 w-fit text-[13px]">
              Founding offer: setup fee waived on {joinNames(waivedNames)} for {FOUNDING_OFFER.audience}
            </Pill>
          ) : null}
        </div>
        <PlanCards plans={plans} />
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          Billed monthly. Cancel anytime; service runs to the end of your paid month. Sales tax added where required.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[var(--line)] px-5 py-4 text-sm">
          <p className="text-[var(--body)]">
            Every plan includes: A person reviews {ASSISTANT_NAME} before she goes live · A local number, or keep yours ·
            Transcripts and recordings · The owner portal
          </p>
          <Link className="font-bold text-[var(--primary-text)] no-underline" href="/pricing">
            Compare plans →
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="flex gap-4 rounded-[20px] bg-[var(--warning-soft)] p-6">
            <IconTile soft="var(--surface)" className="text-[var(--warning-text)]">
              <RefreshCw className="h-5 w-5" />
            </IconTile>
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-extrabold">Follow-up calls</h3>
                <Pill tone="none" className="bg-white text-[var(--warning-text)]">
                  Add-on
                </Pill>
              </div>
              <p className="text-sm text-[var(--body)]">
                {ASSISTANT_NAME} calls your recall list when service is due and books the next visit. Never charged for
                calls that don&apos;t connect.
              </p>
              <Link className="text-sm font-bold text-[var(--warning-text)]" href="/start">
                Ask about pricing →
              </Link>
            </div>
          </article>
          <article className="flex gap-4 rounded-[20px] bg-[var(--purple-soft)] p-6">
            <IconTile soft="var(--surface)" className="text-[var(--purple-text)]">
              <CalendarDays className="h-5 w-5" />
            </IconTile>
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-extrabold">Calendar booking</h3>
                <Pill tone="none" className="bg-white text-[var(--purple-text)]">
                  Professional and Premium
                </Pill>
              </div>
              <p className="text-sm text-[var(--body)]">
                {ASSISTANT_NAME} books straight into your calendar once it&apos;s connected. Google Calendar first; practice
                systems on request.
              </p>
            </div>
          </article>
        </div>
        </div>
      </section>

      {/* Follow-up band */}
      <section className="bg-[#F3F6FA] px-7 py-20">
        <div className="mx-auto grid max-w-[1160px] gap-10 md:grid-cols-2 md:items-center">
          <div className="grid gap-4">
            <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--warning-text)]">FOLLOW-UP ADD-ON</p>
            <h2 className="text-[38px] font-extrabold tracking-[-0.028em]">
              {ASSISTANT_NAME} calls them back, too.
            </h2>
            <p className="text-[var(--body)]">
              Reorders. Annual checkups. Tune-ups. Membership renewals. Every business with a repeat schedule loses revenue
              to customers who simply forgot. Give {ASSISTANT_NAME} your recall list and she calls when it&apos;s due,
              offers the next appointment, and books it.
            </p>
            <ul className="grid gap-2.5 text-sm text-[var(--body)]">
              {[
                "Upload a list, or add customers one at a time",
                "She offers the next opening and books it",
                "One reminder call that lands is worth the whole month",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 text-[var(--success-text)]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-sm italic text-[var(--muted)]">Customers must have agreed to be contacted by phone.</p>
          </div>
          <div
            className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_18px_44px_rgba(15,27,45,0.10)]"
            aria-label="Example recall list"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="text-[17px] font-extrabold text-[var(--ink)]">Recall list</p>
                <p className="text-[13px] text-[var(--muted)]">This week · 12 customers due</p>
              </div>
              <Pill tone="success">4 booked</Pill>
            </div>
            <ul className="divide-y divide-[var(--divider)]">
              {(
                [
                  {
                    initials: "TH",
                    soft: "var(--primary-soft)",
                    ink: "text-[var(--primary-text)]",
                    name: "The Hendersons",
                    service: "Furnace tune-up",
                    status: <Pill tone="success">Booked · Oct 14</Pill>,
                  },
                  {
                    initials: "RP",
                    soft: "var(--live-soft)",
                    ink: "text-[var(--live-text)]",
                    name: "Ravi Patel",
                    service: "AC maintenance plan",
                    status: (
                      <Pill tone="live">
                        <MarketingWaveform heights={WAVE_MINI} size="sm" />
                        Calling now
                      </Pill>
                    ),
                  },
                  {
                    initials: "JA",
                    soft: "var(--purple-soft)",
                    ink: "text-[var(--purple-text)]",
                    name: "Julia Alvarez",
                    service: "Filter replacement",
                    status: <Pill tone="warning">Left a message</Pill>,
                  },
                  {
                    initials: "MB",
                    soft: "var(--neutral-soft)",
                    ink: "text-[var(--neutral-text)]",
                    name: "Mark Brooks",
                    service: "Duct cleaning",
                    status: <Pill tone="neutral">Due Oct 20</Pill>,
                  },
                ]
              ).map((row) => (
                <li key={row.initials} className="flex items-center gap-3 py-3.5">
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${row.ink}`}
                    style={{ background: row.soft }}
                  >
                    {row.initials}
                  </span>
                  <div className="min-w-0 flex-1 grid gap-0.5">
                    <p className="text-[14.5px] font-bold text-[var(--ink)]">{row.name}</p>
                    <p className="text-[13px] text-[var(--muted)]">{row.service}</p>
                  </div>
                  {row.status}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Why owners */}
      <section className="px-7 py-20">
        <div className="mx-auto max-w-[1160px]">
        <div className="mb-10 grid justify-items-center gap-2 text-center">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">WHY OWNERS PICK IT</p>
          <h2 className="text-[38px] font-extrabold tracking-[-0.028em]">Built by people you can actually reach.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "You hear the real thing before you buy.",
              body: `Call the number at the top of this page. That's ${ASSISTANT_NAME}, answering for us.`,
              icon: <Headphones className="h-5 w-5 text-[var(--primary-text)]" />,
            },
            {
              title: "Transcripts and recordings, your eyes only.",
              body: "Encrypted, kept 90 days by default, deleted on your schedule. Staff see them only if you say so.",
              icon: <Lock className="h-5 w-5 text-[var(--primary-text)]" />,
            },
            {
              title: "Built in Morristown, Tennessee.",
              body: "Set up by a person, reviewed before it goes live, and you can reach us.",
              icon: <MapPin className="h-5 w-5 text-[var(--primary-text)]" />,
            },
          ].map((card) => (
            <article key={card.title} className="grid gap-3 rounded-[20px] border border-[var(--line)] p-6">
              <IconTile soft="var(--primary-soft)">{card.icon}</IconTile>
              <h3 className="font-extrabold">{card.title}</h3>
              <p className="text-sm text-[var(--muted)]">{card.body}</p>
            </article>
          ))}
        </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-7 py-16">
        <div className="mx-auto grid max-w-[1160px] gap-10 md:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-3 content-start">
          <p className="text-[13px] font-extrabold tracking-[0.08em] text-[var(--primary)]">QUESTIONS</p>
          <h2 className="text-[38px] font-extrabold tracking-[-0.028em]">Good questions, straight answers.</h2>
          <p className="text-[var(--body)]">
            Still wondering about something? Email us at{" "}
            <a className="font-bold text-[var(--primary-text)]" href={`mailto:${email}`}>
              {email}
            </a>{" "}
            or just call {ASSISTANT_NAME}.
          </p>
        </div>
        <div>
          {[
            {
              q: "Will my callers know they're talking to AI?",
              a: `${ASSISTANT_NAME} sounds natural, and she's honest. If a caller asks whether she's a person, she tells them she's a virtual assistant. Callers also hear a short notice that the call may be recorded.`,
            },
            {
              q: "Do I have to change my phone number?",
              a: `No. Keep your number. Your carrier forwards the calls you don't pick up to ${ASSISTANT_NAME}. If you'd rather, we can set you up with a new local number too.`,
            },
            {
              q: `What happens when ${ASSISTANT_NAME} can't answer something?`,
              a: "She says she doesn't know instead of guessing, takes a detailed message, and sends it to you right away. During business hours she can transfer urgent calls to a person on your team.",
            },
            {
              q: `Can ${ASSISTANT_NAME} book appointments?`,
              a: "Yes. On every plan she takes the appointment request and your office confirms it. On Professional and Premium she can book straight into your calendar once it's connected.",
            },
            {
              q: "How long does setup take?",
              a: `About twenty minutes of your time. ${ASSISTANT_NAME} asks about your hours, services, and how you want calls handled. A person on our team reviews everything before she goes live.`,
            },
            {
              q: "What if I go over my minutes?",
              a: `${ASSISTANT_NAME} keeps answering. Extra minutes are billed at your plan's per-minute rate, shown on each plan above. Minutes only count while she's on the line.`,
            },
          ].map((item, index) => (
            <details key={item.q} className="group border-b border-[var(--line)]" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-bold text-[var(--ink)] [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-[var(--primary)] transition-transform group-open:rotate-180" />
              </summary>
              <p className="max-w-xl pb-5 text-[15px] leading-relaxed text-[var(--body)]">{item.a}</p>
            </details>
          ))}
        </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-7 pb-16">
        <div className="relative mx-auto max-w-[1160px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[var(--primary)] to-[#1d3fa8] px-6 py-14 text-white md:px-12">
          <span className="pointer-events-none absolute -right-6 -top-8 opacity-10">
            <WaveformMark className="h-48 w-48 text-white" />
          </span>
          <div className="relative grid max-w-2xl gap-5">
            <h2 className="text-[40px] font-extrabold tracking-[-0.03em]">Stop missing the calls that matter.</h2>
            <p className="text-lg text-white/90">
              Try {ASSISTANT_NAME} right now, or get set up in about twenty minutes.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-[10px] bg-white px-5 text-base font-extrabold text-[var(--primary-text)] no-underline shadow-[0_0_0_4px_rgba(255,255,255,0.22)]"
                href="/start"
              >
                Get started
              </Link>
              {tel && display ? (
                <a
                  className="inline-flex h-[52px] items-center justify-center gap-2 rounded-[10px] border border-white/55 px-5 text-base font-bold text-white no-underline"
                  href={tel}
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call {ASSISTANT_NAME}: {display}
                </a>
              ) : (
                <Link
                  className="inline-flex h-[52px] items-center justify-center rounded-[10px] border border-white/55 px-5 text-base font-bold text-white no-underline"
                  href="/start"
                >
                  Get started
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
