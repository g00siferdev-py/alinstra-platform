"use client";

import { Button, Card } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export function SignedInSignupCard({
  email,
  role,
  planQuery,
}: {
  email: string;
  role: string;
  /** Preserves `?plan=solo` (etc.) after sign-out. */
  planQuery: string;
}) {
  const [pending, setPending] = useState(false);
  const isAdmin = role === "admin";
  const homeHref = isAdmin ? "/admin" : "/home";
  const homeLabel = isAdmin ? "Go to admin" : "Go to your dashboard";

  async function signOutAndSignup() {
    setPending(true);
    await authClient.signOut();
    window.location.href = planQuery ? `/signup?plan=${encodeURIComponent(planQuery)}` : "/signup";
  }

  return (
    <Card className="grid max-w-lg gap-4">
      <p className="text-sm text-[var(--body)]">
        You&apos;re signed in as <span className="font-semibold text-[var(--ink)]">{email}</span>.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href={homeHref}>
          <Button type="button">{homeLabel}</Button>
        </Link>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void signOutAndSignup()}>
          {pending ? "Signing out…" : "Sign out and create a new account"}
        </Button>
      </div>
    </Card>
  );
}
