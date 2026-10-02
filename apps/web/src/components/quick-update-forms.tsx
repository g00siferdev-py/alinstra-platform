"use client";

import { applyQuickUpdateAction, previewQuickUpdateAction } from "@/app/home/actions";
import { Button, ErrorText } from "@/components/ui";
import type { QuickUpdateInput } from "@alinstra/db";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Faq = { question: string; answer: string };

export function QuickUpdateForms({ hours, staff, faqs }: { hours: string; staff: string; faqs: Faq[] }) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function previewUpdate(input: QuickUpdateInput) {
    setPending(true);
    setError(null);
    setNote(null);
    const result = await previewQuickUpdateAction(input);
    setPending(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    if (!("prompt" in result)) return;
    setPreview(result.prompt ?? "");
    setTruncated(Boolean(result.truncated));
    setNote(result.held ? result.holdReason ?? "Held for review." : null);
  }

  async function applyUpdate(input: QuickUpdateInput) {
    setPending(true);
    setError(null);
    const result = await applyQuickUpdateAction(input);
    setPending(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    if (!("status" in result)) return;
    setPreview(result.prompt ?? "");
    setTruncated(Boolean(result.truncated));
    setNote(result.status === "held" ? result.holdReason ?? "Held for review." : "Applied. A new receptionist version is active.");
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <p className="text-sm">{note}</p> : null}
      {truncated ? <p className="text-sm">Some reference material was cut to fit the prompt size limit.</p> : null}
      {preview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{preview}</pre> : null}

      <form className="grid gap-2 rounded-xl border border-[var(--line)] p-4" onSubmit={(event) => event.preventDefault()}>
        <h2 className="font-medium">Hours</h2>
        <textarea name="hours" className="min-h-24 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={hours} />
        <div className="flex gap-2">
          <Button disabled={pending} onClick={(event) => void previewUpdate({ kind: "hours", text: field(event, "hours") })}>Preview</Button>
          <Button disabled={pending} onClick={(event) => void applyUpdate({ kind: "hours", text: field(event, "hours") })}>Apply</Button>
        </div>
      </form>

      <form className="grid gap-2 rounded-xl border border-[var(--line)] p-4" onSubmit={(event) => event.preventDefault()}>
        <h2 className="font-medium">Closure or temporary notice</h2>
        <textarea name="notice" className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" placeholder="Closed Friday afternoon" />
        <div className="flex gap-2">
          <Button disabled={pending} onClick={(event) => void previewUpdate({ kind: "closure", text: field(event, "notice") })}>Preview</Button>
          <Button disabled={pending} onClick={(event) => void applyUpdate({ kind: "closure", text: field(event, "notice") })}>Apply</Button>
        </div>
      </form>

      <form className="grid gap-2 rounded-xl border border-[var(--line)] p-4" onSubmit={(event) => event.preventDefault()}>
        <h2 className="font-medium">Staff directory</h2>
        <textarea name="staff" className="min-h-24 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={staff} />
        <input name="transfer" className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" placeholder="Transfer number, optional" />
        <div className="flex gap-2">
          <Button disabled={pending} onClick={(event) => void previewUpdate({ kind: "staff", text: field(event, "staff"), transferNumber: field(event, "transfer") })}>Preview</Button>
          <Button disabled={pending} onClick={(event) => void applyUpdate({ kind: "staff", text: field(event, "staff"), transferNumber: field(event, "transfer") })}>Apply</Button>
        </div>
      </form>

      <section className="grid gap-3 rounded-xl border border-[var(--line)] p-4">
        <h2 className="font-medium">FAQs</h2>
        {faqs.length === 0 ? <p className="text-sm text-[var(--muted)]">No FAQs yet.</p> : null}
        {faqs.map((faq, index) => (
          <FaqEditor key={`${faq.question}-${index}`} index={index} faq={faq} pending={pending} onPreview={previewUpdate} onApply={applyUpdate} />
        ))}
        <FaqEditor pending={pending} onPreview={previewUpdate} onApply={applyUpdate} />
      </section>
    </div>
  );
}

function field(event: { currentTarget: EventTarget | null }, name: string): string {
  const form = (event.currentTarget as HTMLButtonElement | null)?.form;
  return String(new FormData(form ?? undefined).get(name) ?? "");
}

function FaqEditor({
  index,
  faq,
  pending,
  onPreview,
  onApply,
}: {
  index?: number;
  faq?: Faq;
  pending: boolean;
  onPreview: (input: QuickUpdateInput) => Promise<void>;
  onApply: (input: QuickUpdateInput) => Promise<void>;
}) {
  const adding = index === undefined;
  return (
    <form className="grid gap-2" onSubmit={(event) => event.preventDefault()}>
      <input name="question" className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={faq?.question ?? ""} placeholder="Question" />
      <textarea name="answer" className="min-h-16 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={faq?.answer ?? ""} placeholder="Answer" />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={(event) => {
            const question = field(event, "question");
            const answer = field(event, "answer");
            const input: QuickUpdateInput = adding
              ? { kind: "faq_add", question, answer }
              : { kind: "faq_edit", index: index ?? 0, question, answer };
            void onPreview(input);
          }}
        >
          Preview
        </Button>
        <Button
          disabled={pending}
          onClick={(event) => {
            const question = field(event, "question");
            const answer = field(event, "answer");
            const input: QuickUpdateInput = adding
              ? { kind: "faq_add", question, answer }
              : { kind: "faq_edit", index: index ?? 0, question, answer };
            void onApply(input);
          }}
        >
          {adding ? "Add FAQ" : "Save FAQ"}
        </Button>
        {adding ? null : (
          <Button disabled={pending} onClick={() => void onApply({ kind: "faq_remove", index: index ?? 0 })}>
            Remove
          </Button>
        )}
      </div>
    </form>
  );
}
