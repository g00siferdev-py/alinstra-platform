"use client";

import { setMonthlyReportEmailAction } from "@/app/home/actions";
import { useToast } from "@/components/toast";
import { ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Owner toggle for the monthly report email (default on). */
export function MonthlyReportEmailToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const id = "monthly-report-email";

  return (
    <div className="grid gap-2">
      <h2 className="text-base font-extrabold text-[var(--ink)]">Monthly report email</h2>
      <p className="text-sm text-[var(--muted)]">
        On the 1st of each month we email headline counts (no caller names, numbers, or message text) with a link to your
        report. Sent at 09:00 Eastern Time.
      </p>
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
              const result = await setMonthlyReportEmailAction({ enabled: next });
              if ("error" in result && result.error) {
                setChecked(!next);
                setError(result.error);
                return;
              }
              toast.success(next ? "Monthly report email on" : "Monthly report email off");
              router.refresh();
            });
          }}
        />
        <span>Email me the monthly report</span>
      </label>
      {error ? (
        <div id={`${id}-error`}>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </div>
  );
}
