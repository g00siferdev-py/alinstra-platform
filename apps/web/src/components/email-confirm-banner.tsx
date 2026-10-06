"use client";

import { resendVerificationAction } from "@/app/(marketing)/signup/actions";
import { Button, Card } from "@/components/ui";
import { useState } from "react";

export function EmailConfirmBanner() {
  const [resending, setResending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
      <p className="min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">
        Confirm your email to submit your setup
        {note ? <span className="ml-2 font-medium text-[var(--muted)]">{note}</span> : null}
        {error ? <span className="ml-2 font-medium text-[var(--danger-text)]">{error}</span> : null}
      </p>
      <Button
        variant="secondary"
        disabled={resending}
        onClick={() => {
          setResending(true);
          setNote(null);
          setError(null);
          void resendVerificationAction().then((result) => {
            setResending(false);
            if (!result.ok) setError(result.error);
            else setNote("Sent.");
          });
        }}
      >
        {resending ? "Sending…" : "Resend"}
      </Button>
    </Card>
  );
}
