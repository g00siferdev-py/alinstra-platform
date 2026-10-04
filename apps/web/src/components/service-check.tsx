"use client";

import { checkServiceAction, type CheckableService } from "@/app/admin/services/actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { useState } from "react";

export function ServiceCheck({ service, label }: { service: CheckableService; label: string }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function check() {
    setPending(true);
    const outcome = await checkServiceAction(service);
    setPending(false);
    if (outcome.ok) {
      setResult({ ok: true, text: outcome.detail });
      toast.success(`${label} check passed`, outcome.detail);
    } else {
      setResult({ ok: false, text: outcome.error });
      toast.error(`${label} check failed`, outcome.error);
    }
  }

  return (
    <div className="grid gap-2">
      <div>
        <Button tone="secondary" disabled={pending} onClick={() => void check()}>{pending ? "Checking…" : "Check"}</Button>
      </div>
      {result ? (
        <p className={`text-sm ${result.ok ? "text-[var(--accent)]" : "text-[var(--danger)]"}`} role="status">
          {result.ok ? "OK" : "Error"} · {result.text}
        </p>
      ) : null}
    </div>
  );
}
