"use client";

import { updatePlanAction, type ActionState } from "@/app/admin/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState } from "react";

type PlanRow = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  includedMinutes: number;
  overagePerMinuteCents: number;
  setupFeeCents: number;
  includedChangesPerMonth: number | null;
  extraChangeFeeCents: number;
};

export function PlanEditor({ plan }: { plan: PlanRow }) {
  const [state, action, pending] = useActionState(updatePlanAction, null as ActionState);
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  return (
    <form action={action} className="grid gap-2 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-medium">{plan.name}</h2>
      <input type="hidden" name="planId" value={plan.id} />
      <Label>Monthly ($)</Label>
      <Input name="monthly" defaultValue={dollars(plan.monthlyPriceCents)} />
      <Label>Included minutes</Label>
      <Input name="minutes" defaultValue={String(plan.includedMinutes)} />
      <Label>Overage ($ / min)</Label>
      <Input name="overage" defaultValue={dollars(plan.overagePerMinuteCents)} />
      <Label>Setup ($)</Label>
      <Input name="setup" defaultValue={dollars(plan.setupFeeCents)} />
      <Label>Changes / month (blank = unlimited)</Label>
      <Input name="includedChanges" defaultValue={plan.includedChangesPerMonth ?? ""} />
      <Label>Extra change fee ($)</Label>
      <Input name="extraChange" defaultValue={dollars(plan.extraChangeFeeCents)} />
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {state?.ok ? <p className="text-sm">Saved.</p> : null}
      <Button disabled={pending} type="submit">Save</Button>
    </form>
  );
}
