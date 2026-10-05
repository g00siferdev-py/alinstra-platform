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
import { useState, useTransition } from "react";

export type InterviewChatTurn = { role: "user" | "assistant"; content: string };

export type InterviewChatAudience = "admin" | "owner";

export function InterviewChat({
  sessionId,
  clientId,
  audience,
  initialTranscript,
  initialCaptured,
  initialDone,
}: {
  sessionId: string;
  clientId: string;
  audience: InterviewChatAudience;
  initialTranscript: InterviewChatTurn[];
  initialCaptured: Record<string, unknown>;
  initialDone: boolean;
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [captured, setCaptured] = useState(initialCaptured);
  const [done, setDone] = useState(initialDone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || pending) return;
    setError(null);
    setTranscript((rows) => [...rows, { role: "user", content: text }]);
    setMessage("");
    startTransition(async () => {
      const result =
        audience === "admin"
          ? await adminSendInterviewMessage(sessionId, text)
          : await ownerSendInterviewMessage(sessionId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.reply) {
        setTranscript((rows) => [...rows, { role: "assistant", content: result.reply! }]);
      }
      if (result.captured) setCaptured(result.captured);
      if (result.done) setDone(true);
    });
  }

  const rows = flattenCaptured(captured);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section className="grid gap-3">
        <div className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-xl border border-[var(--line)] p-4">
          {transcript.map((turn, index) => (
            <div
              key={`${turn.role}-${index}`}
              className={turn.role === "assistant" ? "text-sm" : "text-sm text-[var(--muted)]"}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                {turn.role === "assistant" ? "Alinstra" : "You"}
              </p>
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </div>
          ))}
        </div>
        {!done ? (
          <form onSubmit={submitMessage} className="grid gap-2">
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Type your answer…"
              disabled={pending}
            />
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button disabled={pending || !message.trim()} type="submit">
              {pending ? "Sending…" : "Send"}
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
            disabled={pending}
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
            disabled={pending}
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
