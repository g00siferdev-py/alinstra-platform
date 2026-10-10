"use client";

import { approveGoLiveAction, declineGoLiveAction, pauseAvaAction, resumeAvaAction, setAutoGoLiveAction } from "@/app/admin/go-live-actions";
import { Button, ErrorText } from "@/components/ui";
import { useState, useTransition } from "react";

export function AutoGoLiveSetting({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-bold text-[var(--ink)]">Auto go-live</p>
        <p className="text-sm text-[var(--muted)]">
          {on ? "On. A paid setup can go live without a manual gate." : "Off. New setups stay held until you approve them."}
        </p>
      </div>
      <Button
        variant={on ? "danger" : "primary"}
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const next = !on;
            const result = await setAutoGoLiveAction(next);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setOn(next);
          });
        }}
      >
        {pending ? "Saving…" : on ? "Turn off" : "Turn on"}
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

export function GoLiveReviewActions({ clientId, held }: { clientId: string; held: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!held) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await approveGoLiveAction(clientId);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        Approve and go live
      </Button>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await declineGoLiveAction(clientId);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        Decline
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

export function PauseAvaButton({ clientId, paused }: { clientId: string; paused: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={paused ? "primary" : "secondary"}
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = paused ? await resumeAvaAction(clientId) : await pauseAvaAction(clientId);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {pending ? "Saving…" : paused ? "Resume" : "Pause Ava"}
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
