"use client";

import {
  approveChangeRequestAction,
  approveQuickUpdateAction,
  previewChangeRequestAction,
  previewHeldUpdateAction,
  rejectChangeRequestAction,
  rejectQuickUpdateAction,
} from "@/app/admin/agent-actions";
import { Button, ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HeldUpdateReview({ id, kind, holdReason, payload }: { id: string; kind: string; holdReason: string | null; payload: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <article className="grid gap-2 rounded-xl border border-[var(--line)] p-4 text-sm">
      <p className="font-medium">{kind}</p>
      <p>{holdReason}</p>
      <pre className="whitespace-pre-wrap text-xs">{payload}</pre>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {preview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{preview}</pre> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void previewHeldUpdateAction(id).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else setPreview(result.prompt ?? "");
          });
        }}>Preview</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void approveQuickUpdateAction(id).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}>Approve</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void rejectQuickUpdateAction(id).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}>Reject</Button>
      </div>
    </article>
  );
}

export function ChangeRequestReview({ id, category, description, feeCents }: { id: string; category: string; description: string; feeCents: number | null }) {
  const router = useRouter();
  const [text, setText] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <article className="grid gap-2 rounded-xl border border-[var(--line)] p-4 text-sm">
      <p className="font-medium">{category}{feeCents ? ` · $${(feeCents / 100).toFixed(2)} extra fee` : ""}</p>
      <textarea className="min-h-24 w-full rounded-md border border-[var(--line)] px-3 py-2" value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {truncated ? <p>Some reference material was cut to fit the prompt size limit.</p> : null}
      {preview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{preview}</pre> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void previewChangeRequestAction({ id, description: text }).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else {
              setPreview(result.prompt ?? "");
              setTruncated(Boolean(result.truncated));
            }
          });
        }}>Preview</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void approveChangeRequestAction({ id, description: text }).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}>Approve</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          void rejectChangeRequestAction(id).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}>Reject</Button>
      </div>
    </article>
  );
}
