"use client";

import { cancelPlanChangeAction, openCustomerPortalAction, requestPlanChangeAction } from "@/app/home/billing/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";

type PlanOption = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  includedMinutes: number;
};

function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars}`;
  return `$${dollars.toFixed(2)}`;
}

export function BillingActions({
  hasStripeCustomer,
  openRequestId,
  plans,
}: {
  hasStripeCustomer: boolean;
  openRequestId: string | null;
  plans: PlanOption[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!hasStripeCustomer || pending}
          onClick={() => {
            setError(null);
            start(() => {
              void openCustomerPortalAction().then((result) => {
                if (result && "error" in result && result.error) setError(result.error);
              });
            });
          }}
        >
          Manage billing
        </Button>
        <Button
          variant="secondary"
          disabled={Boolean(openRequestId) || pending || plans.length === 0}
          onClick={() => setPicking((value) => !value)}
        >
          Change plan
        </Button>
        {openRequestId ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(() => {
                void cancelPlanChangeAction(openRequestId).then((result) => {
                  if (result.error) setError(result.error);
                });
              });
            }}
          >
            Cancel request
          </Button>
        ) : null}
      </div>
      {picking ? (
        <ul className="grid gap-2">
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
              <div>
                <p className="font-bold text-[var(--ink)]">{plan.name}</p>
                <p className="text-sm text-[var(--muted)]">
                  {formatCents(plan.monthlyPriceCents)}/mo · {plan.includedMinutes} min
                </p>
              </div>
              <Button
                variant="small"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(() => {
                    void requestPlanChangeAction(plan.id).then((result) => {
                      if (result.error) setError(result.error);
                      else setPicking(false);
                    });
                  });
                }}
              >
                Request
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
