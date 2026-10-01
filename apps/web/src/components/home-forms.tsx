"use client";

import { createClientAction, inviteOwnerAction, inviteStaffAction, type ActionState } from "@/app/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState } from "react";

export function CreateClientForm() {
  const [state, action, pending] = useActionState(createClientAction, null as ActionState);
  return (
    <form className="grid gap-3" action={action}>
      <div>
        <Label htmlFor="name">New client</Label>
        <Input id="name" name="name" required />
      </div>
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {state?.ok ? <p className="text-sm">Client created.</p> : null}
      <Button type="submit" disabled={pending}>
        Create client
      </Button>
    </form>
  );
}

export function InviteOwnerForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(inviteOwnerAction, null as ActionState);
  return (
    <form className="grid gap-3" action={action}>
      <div>
        <Label htmlFor="clientId">Client</Label>
        <select id="clientId" name="clientId" className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm" required>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="email">Owner email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {state?.ok ? <p className="text-sm">Invite queued.</p> : null}
      <Button type="submit" disabled={pending || clients.length === 0}>
        Invite owner
      </Button>
    </form>
  );
}

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaffAction, null as ActionState);
  return (
    <form className="grid gap-3" action={action}>
      <div>
        <Label htmlFor="staff-email">Staff email</Label>
        <Input id="staff-email" name="email" type="email" required />
      </div>
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {state?.ok ? <p className="text-sm">Invite queued.</p> : null}
      <Button type="submit" disabled={pending}>
        Invite staff
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <Button
      type="button"
      onClick={async () => {
        const { authClient } = await import("@/lib/auth-client");
        await authClient.signOut();
        window.location.href = "/login";
      }}
    >
      Sign out
    </Button>
  );
}
