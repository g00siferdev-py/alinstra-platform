"use client";

import { startWizardAction, type ActionState } from "@/app/admin/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState } from "react";

export function NewClientForm({
  defaults,
}: {
  defaults?: {
    business?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    industry?: string;
    leadId?: string;
  };
}) {
  const [state, action, pending] = useActionState(startWizardAction, null as ActionState);
  return (
    <form action={action} className="grid gap-3">
      <Label htmlFor="name">Business name</Label>
      <Input id="name" name="name" required defaultValue={defaults?.business ?? ""} />
      <Label htmlFor="contactName">Contact name</Label>
      <Input id="contactName" name="contactName" defaultValue={defaults?.contactName ?? ""} />
      <Label htmlFor="contactPhone">Contact phone</Label>
      <Input id="contactPhone" name="contactPhone" defaultValue={defaults?.contactPhone ?? ""} />
      <Label htmlFor="contactEmail">Contact email</Label>
      <Input id="contactEmail" name="contactEmail" type="email" defaultValue={defaults?.contactEmail ?? ""} />
      <Label htmlFor="industry">Industry</Label>
      <Input id="industry" name="industry" defaultValue={defaults?.industry ?? ""} placeholder="hvac, veterinary, …" />
      {defaults?.leadId ? <input type="hidden" name="leadId" value={defaults.leadId} /> : null}
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      <Button disabled={pending} type="submit">
        Start wizard
      </Button>
    </form>
  );
}
