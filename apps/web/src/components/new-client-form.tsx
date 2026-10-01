"use client";

import { startWizardAction, type ActionState } from "@/app/admin/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState } from "react";

export function NewClientForm() {
  const [state, action, pending] = useActionState(startWizardAction, null as ActionState);
  return (
    <form action={action} className="grid gap-3">
      <Label htmlFor="name">Business name</Label>
      <Input id="name" name="name" required />
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      <Button disabled={pending} type="submit">Start wizard</Button>
    </form>
  );
}
