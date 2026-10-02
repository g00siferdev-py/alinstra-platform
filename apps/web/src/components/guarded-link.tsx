"use client";

import { useNavigationGuard } from "@/components/navigation-guard";
import type { ReactNode } from "react";

export function GuardedLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const guard = useNavigationGuard();
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (!guard) return;
        event.preventDefault();
        void guard.requestLeave().then((allowed) => {
          if (allowed) window.location.assign(href);
        });
      }}
    >
      {children}
    </a>
  );
}
