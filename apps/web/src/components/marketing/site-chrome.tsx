import { MarketingAuthLink } from "@/components/marketing/auth-link";
import { btnPrimary } from "@/components/marketing/button-classes";
import { WaveformMark } from "@/components/ui";
import { ASSISTANT_NAME, COMPANY_TAGLINE, MARKETING_EMAIL, MARKETING_LOCATION } from "@/lib/brand";
import { marketingPhoneDisplay, marketingTelHref } from "@/lib/marketing-phone";
import Link from "next/link";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/industries", label: "Who it's for" },
  { href: "/about", label: "About" },
] as const;

export function MarketingHeader({ phone }: { phone: string | null }) {
  const display = marketingPhoneDisplay(phone);
  const tel = marketingTelHref(phone);
  return (
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-6 gap-y-3 px-7 py-4">
        <Link className="inline-flex items-center gap-2.5 text-[var(--ink)] no-underline" href="/">
          <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[var(--primary)]">
            <WaveformMark />
          </span>
          <span className="text-lg font-extrabold tracking-[-0.02em]">Alinstra</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-5 text-sm font-semibold">
          {NAV.map((item) => (
            <Link key={item.href} className="text-[var(--ink)] no-underline" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <MarketingAuthLink />
          {tel && display ? (
            <a className={`${btnPrimary} h-[42px] px-4 text-sm`} href={tel}>
              Call {ASSISTANT_NAME}
            </a>
          ) : (
            <Link className={`${btnPrimary} h-[42px] px-4 text-sm`} href="/start">
              Get started
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ email, phone }: { email: string; phone?: string | null }) {
  const display = marketingPhoneDisplay(phone);
  const tel = marketingTelHref(phone);
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[var(--line)] bg-white">
      <div className="mx-auto grid max-w-[1160px] gap-10 px-7 py-12 md:grid-cols-4">
        <div className="grid gap-3 content-start">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--primary)]">
              <WaveformMark />
            </span>
            <span className="font-extrabold text-[var(--ink)]">Alinstra</span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Alinstra Technologies LLC — {COMPANY_TAGLINE}.
          </p>
          <p className="text-sm text-[var(--muted)]">
            Practical AI for small businesses, starting with the phone. {MARKETING_LOCATION}.
          </p>
        </div>
        <div className="grid gap-2 content-start text-sm">
          <p className="font-extrabold text-[var(--ink)]">Product</p>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/pricing">
            Pricing
          </Link>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/industries">
            Who it&apos;s for
          </Link>
          {tel && display ? (
            <a className="font-semibold text-[var(--body)] no-underline" href={tel}>
              Call {ASSISTANT_NAME}
            </a>
          ) : (
            <Link className="font-semibold text-[var(--body)] no-underline" href="/start">
              Get started
            </Link>
          )}
          <Link className="font-semibold text-[var(--body)] no-underline" href="/login">
            Log in
          </Link>
        </div>
        <div className="grid gap-2 content-start text-sm">
          <p className="font-extrabold text-[var(--ink)]">Company</p>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/about">
            About
          </Link>
          <a className="font-semibold text-[var(--body)] no-underline" href={`mailto:${email || MARKETING_EMAIL}`}>
            {email || MARKETING_EMAIL}
          </a>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/start">
            Get started
          </Link>
        </div>
        <div className="grid gap-2 content-start text-sm">
          <p className="font-extrabold text-[var(--ink)]">Legal</p>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/legal#privacy">
            Privacy
          </Link>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/legal#terms">
            Terms
          </Link>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/legal#ai-disclosure">
            AI disclosure
          </Link>
        </div>
      </div>
      <div className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-3 px-7 py-5 text-sm text-[var(--muted)]">
          <p>© {year} Alinstra Technologies LLC</p>
          <Link className="font-semibold text-[var(--body)] no-underline" href="/legal#ai-disclosure">
            Calls are answered by an AI assistant and may be recorded.
          </Link>
        </div>
      </div>
    </footer>
  );
}
