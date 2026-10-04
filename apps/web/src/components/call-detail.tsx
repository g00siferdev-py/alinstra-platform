import { AudioPlayer } from "@/components/audio-player";
import { OutcomeBadge, SentimentLabel } from "@/components/calls-list";
import { CopyButton } from "@/components/copy-button";
import { formatCents, formatDuration, formatOffset, purgedNotice } from "@/lib/call-view";
import { formatLocalTime, formatPhone, toolCallLabel, type CallDetail as CallDetailData, type CallTurn } from "@alinstra/db";
import Link from "next/link";

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
};

function TurnLine({ turn, assistantName }: { turn: CallTurn; assistantName: string }) {
  if (turn.kind === "tool_call") {
    return (
      <li className="flex gap-3 text-sm text-[var(--muted)]">
        <span className="w-12 shrink-0 tabular-nums" aria-hidden="true" />
        <span className="italic">{toolCallLabel(turn)}</span>
      </li>
    );
  }
  const speaker = turn.role === "agent" ? assistantName : turn.role === "caller" ? "Caller" : "Transfer";
  return (
    <li className="flex gap-3 text-sm">
      <span className="w-12 shrink-0 text-xs tabular-nums text-[var(--muted)]">{formatOffset(turn.startSeconds)}</span>
      <span>
        <span className="font-medium">{speaker}:</span> {turn.text}
      </span>
    </li>
  );
}

export function CallDetail({ call, timezone, assistantName, retentionDays, fullNumbers, admin, messageHref, backHref }: Props) {
  const when = call.startedAt ? formatLocalTime(call.startedAt, timezone) : "—";
  const caller = fullNumbers ? formatPhone(call.caller) || call.caller : call.caller;
  const turns = call.transcript?.turns ?? [];
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6">
      <Link className="text-sm text-[var(--muted)]" href={backHref}>Calls</Link>
      <header>
        <h1 className="text-2xl font-semibold">Call on {when}</h1>
        <p className="text-sm text-[var(--muted)]">{caller} · {formatDuration(call.durationSeconds)}</p>
      </header>

      {call.purgedAt ? (
        <p className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm">{purgedNotice(formatLocalTime(call.purgedAt, timezone), retentionDays)}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          {!call.purgedAt ? (
            <section className="rounded-xl border border-[var(--line)] p-4">
              <h2 className="mb-2 font-medium">Recording</h2>
              {call.recordingStatus === "stored" ? (
                <AudioPlayer src={`/api/calls/${call.id}/recording`} contentType={call.recordingContentType ?? "audio/wav"} />
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  {call.recordingStatus === "pending"
                    ? "The recording is still being copied. Check back in a minute."
                    : call.recordingStatus === "failed"
                      ? `The recording could not be copied.${admin && call.recordingError ? ` ${call.recordingError}` : ""}`
                      : "No recording for this call."}
                </p>
              )}
            </section>
          ) : null}

          <section className="rounded-xl border border-[var(--line)] p-4">
            <h2 className="mb-2 font-medium">Transcript</h2>
            {call.purgedAt ? (
              <p className="text-sm text-[var(--muted)]">Purged.</p>
            ) : turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{call.transcript?.text ? call.transcript.text : "No transcript yet."}</p>
            ) : (
              <ol className="grid gap-2">
                {turns.map((turn, index) => (
                  <TurnLine key={index} turn={turn} assistantName={assistantName} />
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-xl border border-[var(--line)] p-4 text-sm">
            <h2 className="mb-2 font-medium">Summary</h2>
            <p className="whitespace-pre-wrap">{call.purgedAt ? "Purged." : call.summary ?? "Not analyzed yet."}</p>
          </section>
          <section className="grid gap-2 rounded-xl border border-[var(--line)] p-4 text-sm">
            <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Outcome</span><OutcomeBadge outcome={call.outcome} /></div>
            <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Sentiment</span><SentimentLabel sentiment={call.sentiment} /></div>
            <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Duration</span><span className="tabular-nums">{formatDuration(call.durationSeconds)}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Ended</span><span>{call.endReason?.replace(/_/g, " ") ?? "—"}</span></div>
            {call.message ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Message</span>
                {messageHref ? <Link href={messageHref}>From {call.message.callerName}</Link> : <span>From {call.message.callerName}</span>}
              </div>
            ) : null}
          </section>
          {admin ? (
            <section className="grid gap-2 rounded-xl border border-[var(--line)] p-4 text-sm">
              <h2 className="font-medium">Admin</h2>
              <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Cost</span><span>{formatCents(call.costCents)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Retell call id</span>
                <span className="flex items-center gap-2"><code className="text-xs">{call.retellCallId}</code><CopyButton value={call.retellCallId} label="call id" /></span>
              </div>
              <div className="flex items-center justify-between gap-2"><span className="text-[var(--muted)]">Recording</span><span>{call.recordingStatus}{call.recordingBytes ? ` · ${Math.round(call.recordingBytes / 1024)} KB` : ""}</span></div>
              {call.rawEvents && call.rawEvents.length > 0 ? (
                <details>
                  <summary className="cursor-pointer">Raw events ({call.rawEvents.length})</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-[var(--card)] p-2 text-xs">{JSON.stringify(call.rawEvents, null, 2)}</pre>
                </details>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
