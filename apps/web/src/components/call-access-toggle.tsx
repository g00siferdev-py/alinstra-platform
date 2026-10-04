"use client";

import { setCallAccessAction } from "@/app/home/actions";
import { useToast } from "@/components/toast";
import { ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = { userId: string; email: string; canViewCalls: boolean };

/** Per-staff switch for call access. Every change is logged under `call_access` on the client's change log. */
export function CallAccessToggle({ userId, email, canViewCalls }: Props) {
  const [checked, setChecked] = useState(canViewCalls);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const id = `call-access-${userId}`;
  return (
    <div className="grid gap-1">
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={pending}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            const next = event.target.checked;
            setChecked(next);
            setError(null);
            startTransition(async () => {
              const result = await setCallAccessAction({ userId, canViewCalls: next });
              if ("error" in result && result.error) {
                setChecked(!next);
                setError(result.error);
                return;
              }
              toast.success(next ? "Call access granted" : "Call access removed", email);
              router.refresh();
            });
          }}
        />
        <span>Can view calls</span>
      </label>
      {error ? (
        <div id={`${id}-error`}>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </div>
  );
}
