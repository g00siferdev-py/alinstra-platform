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
import { Button, Card, ErrorText, Pill, ProgressBar } from "@/components/ui";
import { Check, Circle, MessageSquare } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";

export type InterviewChatTurn = { role: "user" | "assistant"; content: string };

export type InterviewChatAudience = "admin" | "owner";

export type InterviewSendResult =
  | { ok: true; reply?: string; captured?: Record<string, unknown>; done?: boolean }
  | { ok: false; error: string };

export type InterviewChecklistItem = {
  id: string;
  label: string;
  status: "done" | "now" | "todo";
};

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
    <div className="flex items-end gap-2" data-testid="interview-thinking">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
        <MessageSquare className="h-4 w-4" />
      </span>
      <div className="rounded-2xl bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="interview-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{label}</span>
          {phase === "slow" ? (
            <button type="button" className="font-semibold underline" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
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
  checklist,
  exitHref,
  sendMessage,
}: {
  sessionId: string;
  clientId: string;
  audience: InterviewChatAudience;
  initialTranscript: InterviewChatTurn[];
  initialCaptured: Record<string, unknown>;
  initialDone: boolean;
  checklist: InterviewChecklistItem[];
  exitHref: string;
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
    void runSend(text);
  }

  const doneCount = checklist.filter((item) => item.status === "done").length;
  const inputDisabled = sending || actionPending || done;
  void captured;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
      <Card className="grid gap-4">
        <div
          ref={scrollAreaRef}
          className="grid max-h-[32rem] gap-3 overflow-y-auto"
          data-testid="interview-transcript"
        >
          {transcript.map((turn, index) => {
            const isLastUser =
              turn.role === "user" && index === transcript.map((row) => row.role).lastIndexOf("user");
            const isAssistant = turn.role === "assistant";
            return (
              <div
                key={`${turn.role}-${index}`}
                className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
              >
                <div className={`flex max-w-[90%] items-end gap-2 ${isAssistant ? "" : "flex-row-reverse"}`}>
                  {isAssistant ? (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                  ) : null}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                      isAssistant ? "bg-[var(--surface-subtle)] text-[var(--ink)]" : "bg-[var(--primary)] text-white"
                    }`}
                  >
                    {turn.content}
                    {isLastUser && sendFailed && !sending ? (
                      <p className="mt-2 text-sm text-white/90" data-testid="interview-send-error">
                        That didn&apos;t go through.{" "}
                        <button type="button" className="underline" onClick={retrySend}>
                          Try again
                        </button>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {sending ? <ThinkingBubble phase={thinkingPhase} onRetry={retrySend} /> : null}
          <div ref={transcriptEndRef} />
        </div>

        {!done ? (
          <form onSubmit={submitMessage} className="grid gap-2">
            <textarea
              className="min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm outline-none"
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
            Finish and review
          </Button>
          <a href={exitHref}>
            <Button type="button" variant="secondary" disabled={sending || actionPending}>
              Save and exit
            </Button>
          </a>
          <Button
            type="button"
            variant="danger"
            disabled={sending || actionPending}
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
      </Card>

      <aside className="grid gap-4 content-start">
        <Card className="grid gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">What we&apos;ve covered</h2>
            <span className="text-xs font-semibold text-[var(--muted)]">
              {doneCount} of {checklist.length} topics
            </span>
          </div>
          <ProgressBar value={doneCount} max={checklist.length || 1} />
          <ul className="grid gap-2">
            {checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                {item.status === "done" ? (
                  <Check className="h-4 w-4 text-[var(--success-text)]" aria-hidden="true" />
                ) : item.status === "now" ? (
                  <Circle className="h-4 w-4 fill-[var(--primary)] text-[var(--primary)]" aria-hidden="true" />
                ) : (
                  <Circle className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
                )}
                <span className={item.status === "todo" ? "text-[var(--muted)]" : "font-semibold text-[var(--ink)]"}>
                  {item.label}
                </span>
                {item.status === "now" ? <Pill tone="info">Now</Pill> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="border border-[var(--primary-soft)] bg-[var(--primary-soft)]">
          <p className="text-sm text-[var(--primary-text)]">
            You can stop anytime. Everything you&apos;ve answered is saved as you go.
          </p>
        </Card>
      </aside>
    </div>
  );
}
