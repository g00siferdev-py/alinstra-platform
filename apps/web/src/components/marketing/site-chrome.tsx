import { MarketingAuthLink } from "@/components/marketing/auth-link";
import { WaveformMark } from "@/components/marketing/waveform-mark";
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
    <header className="border-b border-[var(--line)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
        <Link className="flex items-center gap-2 text-[var(--ink)] no-underline" href="/">
          <WaveformMark className="h-7 w-7 text-[var(--accent)]" />
          <span className="text-lg font-semibold tracking-tight">Alinstra</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {NAV.map((item) => (
            <Link key={item.href} className="text-[var(--ink)] no-underline" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <MarketingAuthLink />
          {tel && display ? (
            <a
              className="inline-block rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] no-underline"
              href={tel}
            >
              Call {ASSISTANT_NAME}
            </a>
          ) : (
            <Link
              className="inline-block rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] no-underline"
              href="/start"
            >
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
    <footer className="mt-16 border-t border-[var(--line)]">
      <div className="mx-auto grid max-w-5xl gap-4 px-6 py-10 text-sm text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-2 text-[var(--ink)]">
          <WaveformMark className="h-5 w-5 text-[var(--accent)]" />
          <span className="font-medium">Alinstra</span>
        </div>
        <p>
          <a className="text-[var(--ink)]" href={`mailto:${email}`}>
            {email || MARKETING_EMAIL}
          </a>
          {" · "}
          {MARKETING_LOCATION.replace(", Tennessee", " TN")}
        </p>
        <nav className="flex flex-wrap gap-4">
          <Link href="/legal#privacy">Privacy</Link>
          <Link href="/legal#terms">Terms</Link>
          <Link href="/legal#ai-disclosure">AI disclosure</Link>
        </nav>
        <p>© Alinstra Technologies LLC</p>
      </div>
    </footer>
  );
}
