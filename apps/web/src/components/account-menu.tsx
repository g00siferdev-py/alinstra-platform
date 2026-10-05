"use client";

import { GuardedLink } from "@/components/guarded-link";
import { useNavigationGuard } from "@/components/navigation-guard";
import { useState } from "react";

function initialsFrom(email: string): string {
  const local = email.split("@")[0] ?? "U";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return local.slice(0, 1).toUpperCase();
}

export function SignOutControl({ email, replaceAuthenticator }: { email: string; replaceAuthenticator: boolean }) {
  const guard = useNavigationGuard();
  const [open, setOpen] = useState(false);

  async function signOut() {
    const allowed = guard ? await guard.requestLeave() : true;
    if (!allowed) return;
    const { authClient } = await import("@/lib/auth-client");
    await authClient.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#F6D7B0] text-sm font-extrabold text-[var(--ink)]"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${email}`}
        onClick={() => setOpen((current) => !current)}
      >
        {initialsFrom(email)}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-20 mt-2 grid min-w-52 gap-1 rounded-[14px] bg-[var(--surface)] p-2 shadow-[var(--shadow-card)] ring-1 ring-[var(--line)]"
          role="menu"
        >
          <p className="truncate px-2 py-1 text-xs font-semibold text-[var(--muted)]">{email}</p>
          <GuardedLink className="rounded-lg px-2 py-1.5 text-sm font-semibold text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]" href="/account">
            Account
          </GuardedLink>
          {replaceAuthenticator ? (
            <GuardedLink
              className="rounded-lg px-2 py-1.5 text-sm font-semibold text-[var(--ink)] no-underline hover:bg-[var(--surface-subtle)]"
              href="/account/security"
            >
              Replace authenticator
            </GuardedLink>
          ) : null}
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-subtle)]"
            role="menuitem"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
