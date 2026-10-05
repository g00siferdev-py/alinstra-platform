"use client";

import { GuardedLink } from "@/components/guarded-link";
import { usePathname } from "next/navigation";

export type AppNavLink = { href: string; label: string; badge?: string | null };

export function AppNav({ links }: { links: AppNavLink[] }) {
  const pathname = usePathname() ?? "/home";

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map((link) => {
        const active =
          link.href === "/home"
            ? pathname === "/home"
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <GuardedLink
            key={link.href}
            href={link.href}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold no-underline ${
              active
                ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                : "text-[var(--body)] hover:bg-[var(--surface-subtle)]"
            }`}
          >
            {link.label}
            {link.badge ? (
              <span className="rounded-full bg-[var(--live-soft)] px-1.5 py-0.5 text-[11px] font-extrabold text-[var(--live-text)]">
                {link.badge}
              </span>
            ) : null}
          </GuardedLink>
        );
      })}
    </nav>
  );
}
