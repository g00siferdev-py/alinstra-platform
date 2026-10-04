"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Client island so marketing pages stay static/ISR. Checks session once after mount.
 * Shows "Go to dashboard" when signed in, otherwise "Log in".
 */
export function MarketingAuthLink() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/session-status", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { signedIn: false }))
      .then((data: { signedIn?: boolean }) => {
        if (!cancelled) setSignedIn(data.signedIn === true);
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (signedIn === null) {
    return <span className="text-sm text-[var(--muted)]">…</span>;
  }
  if (signedIn) {
    return (
      <Link className="text-sm text-[var(--ink)] no-underline" href="/home">
        Go to dashboard
      </Link>
    );
  }
  return (
    <Link className="text-sm text-[var(--ink)] no-underline" href="/login">
      Log in
    </Link>
  );
}
