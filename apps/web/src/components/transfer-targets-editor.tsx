"use client";

import { Button, ErrorText, Input } from "@/components/ui";
import {
  formatTransferPhoneDisplay,
  formatTransferTargets,
  LIVE_TRANSFER_TARGETS_ERROR,
  normalizeTransferNumber,
  parseTransferTargets,
} from "@alinstra/db/domain";
import { useEffect, useState } from "react";

export type TransferRow = { id: string; label: string; phone: string };

const MAX_ROWS = 5;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row_${Math.random().toString(36).slice(2)}`;
}

function rowsFromText(text: string, contactName: string): TransferRow[] {
  const trimmed = text.trim();
  if (trimmed) {
    try {
      return parseTransferTargets(trimmed).map((row) => ({
        id: newId(),
        label: row.label,
        phone: formatTransferPhoneDisplay(row.e164),
      }));
    } catch {
      // Fall through to a blank/prefilled row when stored text is notes-only or malformed.
    }
  }
  return [{ id: newId(), label: contactName.trim(), phone: "" }];
}

function rowError(row: TransferRow): string | null {
  const label = row.label.trim();
  const phone = row.phone.trim();
  if (!label && !phone) return null;
  if (!label) return "Add a name or role for this number";
  if (!phone) return "That isn't a full US or Canada phone number";
  if (!normalizeTransferNumber(phone)) return "That isn't a full US or Canada phone number";
  return null;
}

export function transferTargetsEditorError(
  liveTransfer: boolean,
  rows: TransferRow[],
): string | null {
  if (!liveTransfer) return null;
  const complete = rows.filter((row) => {
    const label = row.label.trim();
    const phone = row.phone.trim();
    return label && phone && normalizeTransferNumber(phone);
  });
  if (complete.length === 0) return LIVE_TRANSFER_TARGETS_ERROR;
  for (const row of rows) {
    const err = rowError(row);
    if (err && (row.label.trim() || row.phone.trim())) return err;
  }
  return null;
}

export function serializeTransferTargets(liveTransfer: boolean, rows: TransferRow[]): string {
  if (!liveTransfer) return "";
  const parsed: Array<{ label: string; e164: string }> = [];
  for (const row of rows) {
    const label = row.label.trim();
    const e164 = normalizeTransferNumber(row.phone.trim());
    if (label && e164) parsed.push({ label, e164 });
  }
  return formatTransferTargets(parsed);
}

export function TransferTargetsEditor({
  liveTransfer,
  transferTargetsText,
  transferNotes,
  contactName,
  onLiveTransferChange,
  onTargetsChange,
  onValidityChange,
}: {
  liveTransfer: boolean;
  transferTargetsText: string;
  transferNotes?: string;
  contactName?: string;
  onLiveTransferChange: (value: boolean) => void;
  onTargetsChange: (text: string) => void;
  onValidityChange?: (hasError: boolean) => void;
}) {
  const [rows, setRows] = useState<TransferRow[]>(() =>
    rowsFromText(transferTargetsText, contactName ?? ""),
  );

  useEffect(() => {
    const serialized = serializeTransferTargets(liveTransfer, rows);
    if (serialized !== transferTargetsText) onTargetsChange(serialized);
    onValidityChange?.(Boolean(transferTargetsEditorError(liveTransfer, rows)));
  }, [rows, liveTransfer]);

  function updateRow(id: string, patch: Partial<TransferRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function blurPhone(id: string, value: string) {
    const e164 = normalizeTransferNumber(value.trim());
    updateRow(id, { phone: e164 ? formatTransferPhoneDisplay(e164) : value });
  }

  const formError = transferTargetsEditorError(liveTransfer, rows);
  const notes = transferNotes?.trim() ?? "";

  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Transfers</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            className="mt-0.5"
            type="radio"
            name="live-transfer"
            checked={liveTransfer}
            onChange={() => onLiveTransferChange(true)}
          />
          <span>Transfer callers to a person during business hours</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            className="mt-0.5"
            type="radio"
            name="live-transfer"
            checked={!liveTransfer}
            onChange={() => onLiveTransferChange(false)}
          />
          <span>Don&apos;t transfer — Ava takes a message instead</span>
        </label>
      </fieldset>

      {liveTransfer ? (
        <div className="grid gap-3">
          {notes ? (
            <p className="text-sm text-[var(--muted)]">From your setup chat: {notes}</p>
          ) : null}
          <p className="text-xs text-[var(--muted)]">
            Ava only ever transfers to these numbers, and only during your business hours.
          </p>
          {rows.map((row) => {
            const err = rowError(row);
            return (
              <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                <div>
                  <Input
                    aria-label="Name or role"
                    placeholder="Name or role"
                    value={row.label}
                    onChange={(event) => updateRow(row.id, { label: event.target.value })}
                  />
                </div>
                <div>
                  <Input
                    aria-label="Phone number"
                    placeholder="(423) 555-0142"
                    inputMode="tel"
                    value={row.phone}
                    onChange={(event) => updateRow(row.id, { phone: event.target.value })}
                    onBlur={(event) => blurPhone(row.id, event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="small"
                  disabled={rows.length <= 1}
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  Remove
                </Button>
                {err && (row.label.trim() || row.phone.trim()) ? (
                  <div className="sm:col-span-3">
                    <ErrorText>{err}</ErrorText>
                  </div>
                ) : null}
              </div>
            );
          })}
          {rows.length < MAX_ROWS ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRows((current) => [...current, { id: newId(), label: "", phone: "" }])}
            >
              Add another person
            </Button>
          ) : null}
          {formError === LIVE_TRANSFER_TARGETS_ERROR ? <ErrorText>{formError}</ErrorText> : null}
        </div>
      ) : notes ? (
        <p className="text-sm text-[var(--muted)]">From your setup chat: {notes}</p>
      ) : null}
    </div>
  );
}
