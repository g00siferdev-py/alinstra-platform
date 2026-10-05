"use client";

import { Button, Pill } from "@/components/ui";
import { useEffect, useState } from "react";

type LiveCall = {
  id: string;
  clientId: string;
  clientName: string;
  callerMasked: string;
  startedAt: string;
  statusLine: string;
};

function formatElapsed(startedAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveCallBanner() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/admin/live-calls", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { calls: LiveCall[] };
        if (!cancelled) setCalls(body.calls ?? []);
      } catch {
        // ignore transient poll errors
      }
    }
    void load();
    const poll = window.setInterval(() => void load(), 10_000);
    const tick = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  if (calls.length === 0) return null;
  const call = calls[0]!;

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-[20px] border border-[var(--live-border)] bg-[var(--live-soft)] px-5 py-4">
      <div className="min-w-0 flex-1 grid gap-1">
        <Pill tone="live" className="w-fit tracking-[0.08em]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--live-strong)]" />
          LIVE NOW
        </Pill>
        <p className="truncate text-[19px] font-extrabold text-[var(--ink)]">{call.clientName}</p>
        <p className="text-sm text-[var(--live-text)]">
          {call.statusLine} · {call.callerMasked}
        </p>
      </div>
      <div className="live-waveform" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <p className="text-2xl font-extrabold tabular-nums text-[var(--ink)]">{formatElapsed(call.startedAt, nowMs)}</p>
      <a href={`/admin/clients/${call.clientId}/calls/${call.id}`}>
        <Button type="button" variant="secondary">
          View call
        </Button>
      </a>
    </section>
  );
}
