"use client";

import { approvePlanChangeAction, rejectPlanChangeAction } from "@/app/admin/clients/[id]/billing/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";

export function PlanChangeReview({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(() => {
            void approvePlanChangeAction(id).then((result) => {
              if (result.error) setError(result.error);
            });
          });
        }}
      >
        Approve
      </Button>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(() => {
            void rejectPlanChangeAction(id).then((result) => {
              if (result.error) setError(result.error);
            });
          });
        }}
      >
        Reject
      </Button>
      {error ? <p className="w-full text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
