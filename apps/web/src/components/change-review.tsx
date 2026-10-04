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
import type { ReceptionistFields } from "@alinstra/db";
import { VOICE_OPTIONS, voiceDisplayName } from "@alinstra/providers/voices";
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

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="font-medium">{label}</span>
      <textarea className="min-h-16 w-full rounded-md border border-[var(--line)] px-3 py-2" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ChangeRequestReview({
  id,
  category,
  description,
  feeCents,
  fields: initialFields,
}: {
  id: string;
  category: string;
  description: string;
  feeCents: number | null;
  fields: ReceptionistFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState(false);

  function setText(key: keyof ReceptionistFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  return (
    <article className="grid gap-3 rounded-xl border border-[var(--line)] p-4 text-sm">
      <p className="font-medium">{category}{feeCents ? ` · $${(feeCents / 100).toFixed(2)} extra fee` : ""}</p>
      <p className="whitespace-pre-wrap text-[var(--muted)]">{description}</p>
      <p>The request text stays on the request. Publish only the fields below.</p>
      <TextField label="Hours" value={fields.hours} onChange={(value) => setText("hours", value)} />
      <TextField label="Services" value={fields.services} onChange={(value) => setText("services", value)} />
      <TextField label="FAQs" value={fields.faqs} onChange={(value) => setText("faqs", value)} />
      <TextField label="Policies" value={fields.policies} onChange={(value) => setText("policies", value)} />
      <TextField label="Staff" value={fields.staff} onChange={(value) => setText("staff", value)} />
      <TextField label="Notices" value={fields.notices} onChange={(value) => setText("notices", value)} />
      <TextField label="Assistant name" value={fields.assistantName} onChange={(value) => setText("assistantName", value)} />
      <label className="grid gap-1">
        <span className="font-medium">Disclosure</span>
        <select className="rounded-md border border-[var(--line)] px-3 py-2" value={fields.disclosureMode} onChange={(event) => setText("disclosureMode", event.target.value)}>
          <option value="on_request">When asked</option>
          <option value="upfront">In the greeting</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium">Voice</span>
        <select className="rounded-md border border-[var(--line)] px-3 py-2" value={fields.voiceId} onChange={(event) => setText("voiceId", event.target.value)}>
          <option value="">Current default ({voiceDisplayName(undefined)})</option>
          {VOICE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{voiceDisplayName(option.key)}</option>
          ))}
        </select>
      </label>
      <TextField label="Tone" value={fields.tone} onChange={(value) => setText("tone", value)} />
      <TextField label="Languages" value={fields.languages} onChange={(value) => setText("languages", value)} />
      <TextField label="Unanswered after rings" value={fields.unansweredAfterRings} onChange={(value) => setText("unansweredAfterRings", value)} />
      <TextField label="Lunch hours" value={fields.lunchHours} onChange={(value) => setText("lunchHours", value)} />
      <TextField label="After hours" value={fields.afterHours} onChange={(value) => setText("afterHours", value)} />
      <TextField label="Weekends" value={fields.weekends} onChange={(value) => setText("weekends", value)} />
      <TextField label="Holidays" value={fields.holidays} onChange={(value) => setText("holidays", value)} />
      <TextField label="Hold and overflow" value={fields.holdOverflow} onChange={(value) => setText("holdOverflow", value)} />
      <TextField label="Message delivery" value={fields.messages} onChange={(value) => setText("messages", value)} />
      <label className="grid gap-1">
        <span className="font-medium">Booking mode</span>
        <select className="rounded-md border border-[var(--line)] px-3 py-2" value={fields.bookingMode} onChange={(event) => setText("bookingMode", event.target.value)}>
          <option value="">Not set</option>
          <option value="request_only">Request only</option>
          <option value="direct_calendar">Direct calendar</option>
        </select>
      </label>
      <CheckField label="Text confirmations" checked={fields.textConfirmations} onChange={(value) => setFields((current) => ({ ...current, textConfirmations: value }))} />
      <CheckField label="Text reminders" checked={fields.textReminders} onChange={(value) => setFields((current) => ({ ...current, textReminders: value }))} />
      <CheckField label="Live transfer" checked={fields.liveTransfer} onChange={(value) => setFields((current) => ({ ...current, liveTransfer: value }))} />
      <TextField label="Emergency handling" value={fields.emergencyHandling} onChange={(value) => setText("emergencyHandling", value)} />
      <CheckField label="Recall add-on" checked={fields.recallAddOn} onChange={(value) => setFields((current) => ({ ...current, recallAddOn: value }))} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {truncated ? <p>Some reference material was cut to fit the prompt size limit.</p> : null}
      {diff ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{diff}</pre> : null}
      {preview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{preview}</pre> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => {
          setPending(true);
          setError(null);
          void previewChangeRequestAction({ id, fields }).then((result) => {
            setPending(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            const lineText = (result.lines ?? []).map((line) => `${line.op === "add" ? "+" : "-"} ${line.line}`).join("\n");
            const fieldText = (result.fields ?? []).map((field) => `${field.field}: ${field.before || "(empty)"} → ${field.after || "(empty)"}`).join("\n");
            setDiff([lineText, fieldText].filter((part) => part.length > 0).join("\n") || "No prompt changes.");
            setPreview(result.prompt ?? "");
            setTruncated(Boolean(result.truncated));
          });
        }}>Preview</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          setError(null);
          void approveChangeRequestAction({ id, fields }).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}>Publish</Button>
        <Button disabled={pending} onClick={() => {
          setPending(true);
          setError(null);
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
