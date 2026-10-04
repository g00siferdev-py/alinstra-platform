"use client";

import { markLeadContactedAction } from "@/app/admin/leads/actions";
import { Button } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkContactedButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-1 text-right">
      <Button
        type="button"
        tone="secondary"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void markLeadContactedAction(id).then((result) => {
            setPending(false);
            if ("error" in result && result.error) setError(result.error);
            else router.refresh();
          });
        }}
      >
        Mark contacted
      </Button>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
