"use client";

import { cancelChangeRequestAction, submitChangeRequestAction } from "@/app/home/actions";
import { Button, ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CATEGORIES = [
  ["services", "Services"],
  ["call_handling", "Call handling"],
  ["knowledge", "Knowledge"],
  ["voice", "Voice"],
  ["features", "Features"],
  ["other", "Other"],
] as const;

export function ChangeRequestForm({
  unlimited,
  remaining,
  feeCents,
  over,
  requests,
}: {
  unlimited: boolean;
  remaining: number | null;
  feeCents: number;
  over: boolean;
  requests: Array<{ id: string; category: string; description: string; status: string; feeCents: number | null }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmFee, setConfirmFee] = useState(false);

  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {unlimited
          ? "This plan does not limit configuration changes this month."
          : `${remaining ?? 0} configuration change${remaining === 1 ? "" : "s"} left this month.`}
        {over ? ` The next one adds a $${(feeCents / 100).toFixed(2)} fee on a later invoice.` : ""}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <form
        className="grid gap-3 rounded-xl border border-[var(--line)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          setPending(true);
          setError(null);
          void submitChangeRequestAction({
            category: String(data.get("category") ?? ""),
            description: String(data.get("description") ?? ""),
            confirmFee,
          }).then((result) => {
            setPending(false);
            if (result.error) setError(result.error);
            else {
              form.reset();
              setConfirmFee(false);
              router.refresh();
            }
          });
        }}
      >
        <label className="grid gap-1 text-sm">
          Category
          <select name="category" className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-2">
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          What should change?
          <textarea name="description" required className="min-h-28 w-full rounded-md border border-[var(--line)] px-3 py-2" />
        </label>
        {over ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmFee} onChange={(event) => setConfirmFee(event.target.checked)} />
            I confirm the extra change fee of ${(feeCents / 100).toFixed(2)}.
          </label>
        ) : null}
        <Button disabled={pending} type="submit">{pending ? "Sending…" : "Submit request"}</Button>
      </form>
      <ul className="grid gap-3">
        {requests.map((request) => (
          <li key={request.id} className="rounded-xl border border-[var(--line)] p-4 text-sm">
            <p className="font-medium">{request.category} · {request.status}{request.feeCents ? ` · $${(request.feeCents / 100).toFixed(2)}` : ""}</p>
            <p className="mt-1 whitespace-pre-wrap">{request.description}</p>
            {request.status === "pending" ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  void cancelChangeRequestAction(request.id).then((result) => {
                    setPending(false);
                    if (result.error) setError(result.error);
                    else router.refresh();
                  });
                }}
              >
                Cancel
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
