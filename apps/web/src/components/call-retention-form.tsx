"use client";

import { setCallRetentionAction } from "@/app/home/actions";
import { useToast } from "@/components/toast";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { CALL_RETENTION_DEFAULT_DAYS, CALL_RETENTION_HINT, CALL_RETENTION_MAX_DAYS, CALL_RETENTION_MIN_DAYS } from "@/lib/call-retention";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CallRetentionForm({ days }: { days: number }) {
  const [value, setValue] = useState(String(days || CALL_RETENTION_DEFAULT_DAYS));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const parsed = Number(value);
        startTransition(async () => {
          const result = await setCallRetentionAction({ days: parsed });
          if ("error" in result && result.error) {
            setError(result.error);
            return;
          }
          toast.success("Call retention updated", `${parsed} days`);
          router.refresh();
        });
      }}
    >
      <Label htmlFor="call-retention-days">Call retention (days)</Label>
      <p className="text-xs text-[var(--muted)]">{CALL_RETENTION_HINT}</p>
      <p className="text-xs text-[var(--muted)]">Messages are kept {days} days.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="call-retention-days"
          className="w-32"
          type="number"
          inputMode="numeric"
          min={CALL_RETENTION_MIN_DAYS}
          max={CALL_RETENTION_MAX_DAYS}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
