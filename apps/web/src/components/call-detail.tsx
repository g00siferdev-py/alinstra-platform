import { AudioPlayer } from "@/components/audio-player";
import { CallTimelineBars, CallTimelineLegend } from "@/components/call-timeline";
import { OutcomeBadge, SentimentLabel } from "@/components/calls-list";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, Pill } from "@/components/ui";
import { formatCents, formatDuration, formatOffset, purgedNotice } from "@/lib/call-view";
import {
  callTimeline,
  flagExplanation,
  formatLocalTime,
  formatPhone,
  toolCallLabel,
  type CallDetail as CallDetailData,
  type CallFlag,
  type CallTurn,
} from "@alinstra/db";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  call: CallDetailData;
  timezone: string;
  assistantName: string;
  retentionDays: number;
  /** Full caller number shown (owner/admin) or mask (staff). */
  fullNumbers: boolean;
  /** Admin extras: cost, Retell id, raw events. */
  admin: boolean;
  /** Where the captured message lives, when there is one. */
  messageHref: string | null;
  backHref: string;
  businessName?: string | null;
};

function telHref(caller: string): string | null {
  const digits = caller.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  if (caller.startsWith("+") && digits.length >= 10) return `tel:+${digits}`;
  return null;
}

function flagFix(flag: CallFlag, admin: boolean, clientId: string): { label: string; href: string } | null {
  if (!admin) return null;
  if (flag.type === "tool_error") {
    return { label: "Resync agent", href: `/admin/clients/${clientId}` };
  }
  if (flag.type === "short_hangup" || flag.type === "long_silence") {
    return { label: "Open client", href: `/admin/clients/${clientId}` };
  }
  return null;
}

function TranscriptBubbles({
  turns,
  assistantName,
  durationSeconds,
  endReason,
}: {
  turns: CallTurn[];
  assistantName: string;
  durationSeconds: number | null;
  endReason: string | null;
}) {
  const nodes: ReactNode[] = [];
  let lastEnd: number | null = null;

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    if (turn.kind === "tool_call") {
      nodes.push(
        <li key={`tool-${index}`} className="text-center text-xs italic text-[var(--muted)]">
          {toolCallLabel(turn)}
        </li>,
      );
      continue;
    }
    if (turn.startSeconds != null && lastEnd != null && turn.startSeconds - lastEnd > 8) {
      nodes.push(
        <li key={`silence-${index}`} className="text-center">
          <Pill tone="warning">{Math.round(turn.startSeconds - lastEnd)}s silence</Pill>
        </li>,
      );
    }
    if (turn.endSeconds != null) lastEnd = turn.endSeconds;

    const isAgent = turn.role === "agent";
    nodes.push(
      <li key={`turn-${index}`} className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
        <div className={`grid max-w-[85%] gap-1 ${isAgent ? "" : "justify-items-end"}`}>
          <span className="text-[11px] tabular-nums text-[var(--muted)]">{formatOffset(turn.startSeconds)}</span>
          <div className={`flex items-end gap-2 ${isAgent ? "" : "flex-row-reverse"}`}>
            {isAgent ? (
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--live-soft)] text-xs font-extrabold text-[var(--live-text)]">
                A
              </span>
            ) : null}
            <div
              className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                isAgent
                  ? "bg-[#EAF7F3] text-[var(--ink)]"
                  : "bg-[var(--primary)] text-white"
              }`}
            >
              <span className="sr-only">{isAgent ? assistantName : turn.role === "caller" ? "Caller" : "Transfer"}: </span>
              {turn.text}
            </div>
          </div>
        </div>
      </li>,
    );
  }

  const endedBy = endReason?.includes("agent")
    ? assistantName
    : endReason?.includes("user") || endReason?.includes("customer")
      ? "Caller"
      : assistantName;

  nodes.push(
    <li key="end" className="pt-2 text-center">
      <Pill tone="neutral">
        {endedBy} ended the call · {formatDuration(durationSeconds)}
      </Pill>
    </li>,
  );

  return <ol className="grid gap-3">{nodes}</ol>;
}

export function CallDetail({
  call,
  timezone,
  assistantName,
  retentionDays,
  fullNumbers,
  admin,
  messageHref,
  backHref,
  businessName,
}: Props) {
  const when = call.startedAt ? formatLocalTime(call.startedAt, timezone) : "—";
  const caller = fullNumbers ? formatPhone(call.caller) || call.caller : call.caller;
  const turns = call.transcript?.turns ?? [];
  const segments = callTimeline(turns, call.durationSeconds);
  const callbackHref = fullNumbers ? telHref(call.caller) : null;
  const headline = call.summary?.split(/[.!\n]/)[0]?.trim() || `Call with ${caller}`;
  const keptUntil = call.startedAt
    ? formatLocalTime(new Date(call.startedAt.getTime() + retentionDays * 86_400_000), timezone)
    : null;

  return (
    <main className="grid gap-6">
      <Link className="text-sm font-semibold text-[var(--muted)] no-underline" href={backHref}>
        ← Calls
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-[var(--ink)]">{headline}</h1>
            {call.flagged ? <Pill tone="warning">Flagged</Pill> : null}
          </div>
          <p className="text-sm text-[var(--muted)]">
            {when} · {caller} · {formatDuration(call.durationSeconds)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {callbackHref ? (
            <a href={callbackHref}>
              <Button variant="primary">Call them back</Button>
            </a>
          ) : null}
          <Button variant="secondary" disabled title="Coming soon">
            Share with staff · Coming soon
          </Button>
        </div>
      </header>

      {call.purgedAt ? (
        <Card>
          <p className="text-sm">{purgedNotice(formatLocalTime(call.purgedAt, timezone), retentionDays)}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          {!call.purgedAt ? (
            <Card className="grid gap-3">
              <h2 className="text-base font-extrabold">Recording</h2>
              {call.recordingStatus === "stored" ? (
                <>
                  <CallTimelineBars callId={call.id} segments={segments} durationSeconds={call.durationSeconds} />
                  <CallTimelineLegend segments={segments} />
                  <AudioPlayer src={`/api/calls/${call.id}/recording`} contentType={call.recordingContentType ?? "audio/wav"} />
                </>
              ) : (
                <>
                  {segments.length > 0 ? (
                    <>
                      <CallTimelineBars callId={call.id} segments={segments} durationSeconds={call.durationSeconds} />
                      <CallTimelineLegend segments={segments} />
                    </>
                  ) : null}
                  <p className="text-sm text-[var(--muted)]">
                    {call.recordingStatus === "pending"
                      ? "The recording is still being copied. Check back in a minute."
                      : call.recordingStatus === "failed"
                        ? `The recording could not be copied.${admin && call.recordingError ? ` ${call.recordingError}` : ""}`
                        : "No recording for this call."}
                  </p>
                </>
              )}
            </Card>
          ) : null}

          <Card className="grid gap-3">
            <h2 className="text-base font-extrabold">Transcript</h2>
            {call.purgedAt ? (
              <p className="text-sm text-[var(--muted)]">Purged.</p>
            ) : turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{call.transcript?.text ? call.transcript.text : "No transcript yet."}</p>
            ) : (
              <TranscriptBubbles
                turns={turns}
                assistantName={assistantName}
                durationSeconds={call.durationSeconds}
                endReason={call.endReason}
              />
            )}
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          {call.flagged && call.flags.length > 0 ? (
            <Card className="grid gap-3 border border-[var(--warning-pill)] bg-[var(--warning-soft)]">
              <h2 className="text-base font-extrabold text-[var(--warning-text)]">Flagged</h2>
              <ul className="grid gap-3">
                {call.flags.map((flag, index) => {
                  const fix = flagFix(flag, admin, call.clientId);
                  return (
                    <li key={`${flag.type}-${index}`} className="grid gap-1 text-sm">
                      <p className="font-semibold text-[var(--ink)]">{flagExplanation(flag)}</p>
                      {!admin ? (
                        <p className="text-[var(--muted)]">Our team can review this if it looks off.</p>
                      ) : null}
                      {fix ? (
                        <Link className="font-bold text-[var(--primary-text)]" href={fix.href}>
                          {fix.label}
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card className="grid gap-3 text-sm">
            <h2 className="text-base font-extrabold">About this call</h2>
            {businessName ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Business</span>
                <span>{businessName}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Outcome</span>
              <OutcomeBadge outcome={call.outcome} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Caller mood</span>
              <SentimentLabel sentiment={call.sentiment} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Duration</span>
              <span className="tabular-nums">{formatDuration(call.durationSeconds)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Ended</span>
              <span>{call.endReason?.replace(/_/g, " ") ?? "—"}</span>
            </div>
            {call.message ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Message</span>
                {messageHref ? (
                  <Link href={messageHref}>From {call.message.callerName}</Link>
                ) : (
                  <span>From {call.message.callerName}</span>
                )}
              </div>
            ) : null}
            {keptUntil ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Kept until</span>
                <span>{keptUntil}</span>
              </div>
            ) : null}
            {admin ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted)]">Cost</span>
                  <span>{formatCents(call.costCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted)]">Retell call id</span>
                  <span className="flex items-center gap-2">
                    <code className="text-xs">{call.retellCallId}</code>
                    <CopyButton value={call.retellCallId} label="call id" />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted)]">Recording</span>
                  <span>
                    {call.recordingStatus}
                    {call.recordingBytes ? ` · ${Math.round(call.recordingBytes / 1024)} KB` : ""}
                  </span>
                </div>
                {call.rawEvents && call.rawEvents.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer font-semibold">Raw events</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                      {JSON.stringify(call.rawEvents, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </>
            ) : null}
          </Card>
        </aside>
      </div>
    </main>
  );
}
