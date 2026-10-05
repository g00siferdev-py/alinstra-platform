"use client";

import {
  adminDiscardInterview,
  adminFinishInterview,
  adminSendInterviewMessage,
} from "@/app/admin/clients/[id]/interview/actions";
import {
  ownerDiscardInterview,
  ownerFinishInterview,
  ownerSendInterviewMessage,
} from "@/app/home/business/interview/actions";
import { Button, ErrorText } from "@/components/ui";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";

export type InterviewChatTurn = { role: "user" | "assistant"; content: string };

export type InterviewChatAudience = "admin" | "owner";

export type InterviewSendResult =
  | { ok: true; reply?: string; captured?: Record<string, unknown>; done?: boolean }
  | { ok: false; error: string };

export const INTERVIEW_DISCLAIMER =
  "Your receptionist is only as good as the information she's given. The more detail you share, the better she can represent your business.";

type ThinkingPhase = "thinking" | "still" | "slow";

function ThinkingBubble({
  phase,
  onRetry,
}: {
  phase: ThinkingPhase;
  onRetry: () => void;
}) {
  const label =
    phase === "slow" ? "This is taking longer than usual" : phase === "still" ? "Still thinking…" : "Thinking…";
  return (
    <div className="text-sm" data-testid="interview-thinking">
      <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">Alinstra</p>
      <div className="flex flex-wrap items-center gap-2 text-[var(--muted)]">
        <span className="interview-thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{label}</span>
        {phase === "slow" ? (
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function InterviewChat({
  sessionId,
  clientId,
  audience,
  initialTranscript,
  initialCaptured,
  initialDone,
  sendMessage,
}: {
  sessionId: string;
  clientId: string;
  audience: InterviewChatAudience;
  initialTranscript: InterviewChatTurn[];
  initialCaptured: Record<string, unknown>;
  initialDone: boolean;
  /** Test seam — defaults to the real admin/owner server actions. */
  sendMessage?: (sessionId: string, message: string) => Promise<InterviewSendResult>;
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [captured, setCaptured] = useState(initialCaptured);
  const [done, setDone] = useState(initialDone);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase>("thinking");
  const lastSentRef = useRef<string | null>(null);
  const sendGenerationRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const defaultSend = async (sid: string, text: string): Promise<InterviewSendResult> => {
    if (audience === "admin") return adminSendInterviewMessage(sid, text);
    return ownerSendInterviewMessage(sid, text);
  };
  const send = sendMessage ?? defaultSend;

  const scrollToLatest = useEffectEvent(() => {
    const node = transcriptEndRef.current;
    if (!node || typeof node.scrollIntoView !== "function") return;
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  });

  useEffect(() => {
    scrollToLatest();
  }, [transcript, sending, sendFailed, thinkingPhase]);

  useEffect(() => {
    if (!sending) {
      setThinkingPhase("thinking");
      return;
    }
    setThinkingPhase("thinking");
    const still = window.setTimeout(() => setThinkingPhase("still"), 8_000);
    const slow = window.setTimeout(() => setThinkingPhase("slow"), 30_000);
    return () => {
      window.clearTimeout(still);
      window.clearTimeout(slow);
    };
  }, [sending]);

  async function runSend(text: string) {
    lastSentRef.current = text;
    setSending(true);
    setSendFailed(false);
    setError(null);
    const generation = ++sendGenerationRef.current;
    try {
      const result = await send(sessionId, text);
      if (generation !== sendGenerationRef.current) return;
      if (!result.ok) {
        setSendFailed(true);
        setSending(false);
        return;
      }
      if (result.reply) {
        setTranscript((rows) => [...rows, { role: "assistant", content: result.reply! }]);
      }
      if (result.captured) setCaptured(result.captured);
      if (result.done) setDone(true);
      setSending(false);
    } catch {
      if (generation !== sendGenerationRef.current) return;
      setSendFailed(true);
      setSending(false);
    }
  }

  function submitMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || sending || actionPending) return;
    setTranscript((rows) => [...rows, { role: "user", content: text }]);
    setMessage("");
    void runSend(text);
  }

  function retrySend() {
    const text = lastSentRef.current;
    if (!text || actionPending) return;
    // Bump generation so an in-flight response is ignored; do not duplicate the user bubble.
    void runSend(text);
  }

  const rows = flattenCaptured(captured);
  const inputDisabled = sending || actionPending || done;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section className="grid gap-3">
        <div
          ref={scrollAreaRef}
          className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-xl border border-[var(--line)] p-4"
          data-testid="interview-transcript"
        >
          {transcript.map((turn, index) => {
            const isLastUser =
              turn.role === "user" &&
              index === transcript.map((row) => row.role).lastIndexOf("user");
            return (
              <div
                key={`${turn.role}-${index}`}
                className={turn.role === "assistant" ? "text-sm" : "text-sm text-[var(--muted)]"}
              >
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                  {turn.role === "assistant" ? "Alinstra" : "You"}
                </p>
                <p className="whitespace-pre-wrap">{turn.content}</p>
                {isLastUser && sendFailed && !sending ? (
                  <p className="mt-2 text-sm text-[var(--danger)]" data-testid="interview-send-error">
                    That didn&apos;t go through.{" "}
                    <button type="button" className="underline" onClick={retrySend}>
                      Try again
                    </button>
                  </p>
                ) : null}
              </div>
            );
          })}
          {sending ? <ThinkingBubble phase={thinkingPhase} onRetry={retrySend} /> : null}
          <div ref={transcriptEndRef} />
        </div>
        {!done ? (
          <form onSubmit={submitMessage} className="grid gap-2">
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
              placeholder="Type your answer…"
              disabled={inputDisabled}
              aria-label="Interview answer"
            />
            <p className="text-xs text-[var(--muted)]">{INTERVIEW_DISCLAIMER}</p>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button disabled={inputDisabled || !message.trim()} type="submit">
              {sending ? "Waiting…" : "Send"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Interview complete. Finish to copy answers into the wizard, or discard to leave the draft unchanged.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={sending || actionPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result =
                  audience === "admin"
                    ? await adminFinishInterview(sessionId, clientId)
                    : await ownerFinishInterview(sessionId);
                if (result && result.ok === false && result.error) setError(result.error);
              });
            }}
          >
            Finish → review in wizard
          </Button>
          <Button
            type="button"
            disabled={sending || actionPending}
            className="border border-[var(--line)] bg-transparent"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result =
                  audience === "admin"
                    ? await adminDiscardInterview(sessionId, clientId)
                    : await ownerDiscardInterview(sessionId);
                if (result && result.ok === false && result.error) setError(result.error);
              });
            }}
          >
            Discard
          </Button>
        </div>
        {error && done ? <ErrorText>{error}</ErrorText> : null}
      </section>
      <aside className="rounded-xl border border-[var(--line)] p-4 text-sm">
        <h2 className="mb-2 font-medium">Captured so far</h2>
        {rows.length === 0 ? (
          <p className="text-[var(--muted)]">Nothing saved yet.</p>
        ) : (
          <dl className="grid gap-3">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{row.label}</dt>
                <dd className="whitespace-pre-wrap">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </aside>
    </div>
  );
}

function flattenCaptured(captured: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const [section, value] of Object.entries(captured)) {
    if (!value || typeof value !== "object") continue;
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      if (field === undefined || field === null || field === "") continue;
      rows.push({
        label: `${section}.${key}`,
        value: typeof field === "string" ? field : JSON.stringify(field),
      });
    }
  }
  return rows;
}
