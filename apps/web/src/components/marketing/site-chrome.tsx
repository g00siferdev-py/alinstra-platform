import { MarketingAuthLink } from "@/components/marketing/auth-link";
import { btnPrimary } from "@/components/marketing/button-classes";
import { WaveformMark } from "@/components/ui";
import { ASSISTANT_NAME, MARKETING_EMAIL, MARKETING_LOCATION } from "@/lib/brand";
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
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-6 gap-y-3 px-7 py-4">
        <Link className="inline-flex items-center gap-2.5 text-[var(--ink)] no-underline" href="/">
          <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[var(--primary)]">
            <WaveformMark />
          </span>
          <span className="text-lg font-extrabold tracking-[-0.02em]">Alinstra</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm font-semibold">
          {NAV.map((item) => (
            <Link key={item.href} className="text-[var(--ink)] no-underline" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <MarketingAuthLink />
          {tel && display ? (
            <a className={btnPrimary} href={tel}>
              Call {ASSISTANT_NAME}
            </a>
          ) : (
            <Link className={btnPrimary} href="/start">
              Get started
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ email }: { email: string }) {
  return (
    <footer className="mt-16 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-[1160px] gap-4 px-7 py-10 text-sm text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-2.5 text-[var(--ink)]">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--primary)]">
            <WaveformMark />
          </span>
          <span className="font-extrabold">Alinstra</span>
        </div>
        <p>
          <a className="font-semibold text-[var(--ink)]" href={`mailto:${email}`}>
            {email || MARKETING_EMAIL}
          </a>
          {" · "}
          {MARKETING_LOCATION.replace(", Tennessee", " TN")}
        </p>
        <nav className="flex flex-wrap gap-4 font-semibold">
          <Link href="/legal#privacy">Privacy</Link>
          <Link href="/legal#terms">Terms</Link>
          <Link href="/legal#ai-disclosure">AI disclosure</Link>
        </nav>
        <p>© Alinstra Technologies LLC</p>
      </div>
    </footer>
  );
}
