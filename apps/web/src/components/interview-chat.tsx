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
  | {
      ok: true;
      reply?: string;
      captured?: Record<string, unknown>;
      done?: boolean;
      transcript?: InterviewChatTurn[];
    }
  | {
      ok: false;
      error?: string;
      conflict?: boolean;
      transcript?: InterviewChatTurn[];
      captured?: Record<string, unknown>;
      done?: boolean;
    };

export type InterviewChecklistItem = {
  id: string;
  label: string;
  status: "done" | "now" | "todo";
};

export const INTERVIEW_DISCLAIMER =
  "Your receptionist is only as good as the information she's given. The more detail you share, the better she can represent your business.";

type ThinkingPhase = "thinking" | "still" | "slow";

async function streamOrSend(
  sessionId: string,
  message: string,
  clientMessageId: string,
  audience: InterviewChatAudience,
  onToken: (chunk: string) => void,
): Promise<InterviewSendResult> {
  try {
    const response = await fetch("/api/interview/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message, clientMessageId }),
    });
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let doneEvent: InterviewSendResult | null = null;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const event = JSON.parse(trimmed.slice("data:".length).trim()) as {
            type?: string;
            text?: string;
            ok?: boolean;
            reply?: string;
            done?: boolean;
            transcript?: InterviewChatTurn[];
            captured?: Record<string, unknown>;
            conflict?: boolean;
            error?: string;
          };
          if (event.type === "token" && event.text) onToken(event.text);
          if (event.type === "done") {
            doneEvent = event.ok
              ? { ok: true, reply: event.reply, done: event.done, transcript: event.transcript, captured: event.captured }
              : { ok: false, error: event.error, conflict: event.conflict, transcript: event.transcript, captured: event.captured, done: event.done };
          }
        }
      }
      if (doneEvent) return doneEvent;
    }
  } catch {
    // Fall through to the buffered server action.
  }
  const result =
    audience === "admin"
      ? await adminSendInterviewMessage(sessionId, message, clientMessageId)
      : await ownerSendInterviewMessage(sessionId, message, clientMessageId);
  if (!result) return { ok: false, error: "Could not send that." };
  return result;
}

function ThinkingBubble({ phase }: { phase: ThinkingPhase }) {
  const label =
    phase === "slow"
      ? "This is taking longer than usual…"
      : phase === "still"
        ? "Still thinking…"
        : "Thinking…";
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
        </div>
      </div>
    </div>
  );
}

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
  sendMessage?: (
    sessionId: string,
    message: string,
    clientMessageId: string,
  ) => Promise<InterviewSendResult>;
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
  const [pendingReply, setPendingReply] = useState("");
  const lastSentRef = useRef<string | null>(null);
  const lastClientMessageIdRef = useRef<string | null>(null);
  const sendGenerationRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const defaultSend = async (
    sid: string,
    text: string,
    clientMessageId: string,
  ): Promise<InterviewSendResult> => {
    const result =
      audience === "admin"
        ? await adminSendInterviewMessage(sid, text, clientMessageId)
        : await ownerSendInterviewMessage(sid, text, clientMessageId);
    if (!result) return { ok: false, error: "Could not send that." };
    return result;
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
    const still = window.setTimeout(() => setThinkingPhase("still"), 6_000);
    const slow = window.setTimeout(() => setThinkingPhase("slow"), 20_000);
    return () => {
      window.clearTimeout(still);
      window.clearTimeout(slow);
    };
  }, [sending]);

  async function runSend(text: string, clientMessageId: string) {
    lastSentRef.current = text;
    lastClientMessageIdRef.current = clientMessageId;
    setSending(true);
    setPendingReply("");
    setSendFailed(false);
    setError(null);
    const generation = ++sendGenerationRef.current;
    try {
      const result = sendMessage
        ? await send(sessionId, text, clientMessageId)
        : await streamOrSend(sessionId, text, clientMessageId, audience, (chunk) => {
            setPendingReply((current) => current + chunk);
          });
      if (generation !== sendGenerationRef.current) return;
      if (!result.ok) {
        if (result.conflict && result.transcript) {
          setTranscript(result.transcript);
          if (result.captured) setCaptured(result.captured);
          if (result.done) setDone(true);
          setSending(false);
          return;
        }
        setSendFailed(true);
        setSending(false);
        return;
      }
      if (result.transcript) {
        setTranscript(result.transcript);
      } else if (result.reply) {
        setTranscript((rows) => [...rows, { role: "assistant", content: result.reply! }]);
      }
      if (result.captured) setCaptured(result.captured);
      if (result.done) setDone(true);
      setPendingReply("");
      setSending(false);
    } catch {
      if (generation !== sendGenerationRef.current) return;
      setPendingReply("");
      setSendFailed(true);
      setSending(false);
    }
  }

  function submitMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || sending || actionPending) return;
    const clientMessageId = newClientMessageId();
    setTranscript((rows) => [...rows, { role: "user", content: text }]);
    setMessage("");
    void runSend(text, clientMessageId);
  }

  function retrySend() {
    const text = lastSentRef.current;
    const clientMessageId = lastClientMessageIdRef.current;
    if (!text || !clientMessageId || actionPending) return;
    void runSend(text, clientMessageId);
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
          {sending && pendingReply ? (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm whitespace-pre-wrap text-[var(--ink)]">
                {pendingReply}
              </div>
            </div>
          ) : null}
          {sending && !pendingReply ? <ThinkingBubble phase={thinkingPhase} /> : null}
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
