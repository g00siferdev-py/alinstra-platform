"use client";

import { GuardedLink } from "@/components/guarded-link";
import { useNavigationGuard } from "@/components/navigation-guard";
import { useState } from "react";

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
        className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {email}
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 grid min-w-48 gap-1 rounded-md border border-[var(--line)] bg-[var(--card)] p-2 shadow-sm" role="menu">
          {replaceAuthenticator ? (
            <GuardedLink className="rounded px-2 py-1 text-sm text-[var(--ink)] no-underline" href="/account/security">
              Replace authenticator
            </GuardedLink>
          ) : null}
          <button type="button" className="cursor-pointer rounded px-2 py-1 text-left text-sm" role="menuitem" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
