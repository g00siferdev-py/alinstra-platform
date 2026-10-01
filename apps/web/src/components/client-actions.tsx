"use client";

import { discardWizardAction, removeClientAction, sendPortalInviteAction } from "@/app/admin/actions";
import { Button, ErrorText } from "@/components/ui";
import { useState } from "react";

export function RemoveClientButton({ clientId, name }: { clientId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="shrink-0">
      <button
        type="button"
        className="cursor-pointer rounded-md border border-[var(--danger)] bg-white px-3 py-1.5 text-sm text-[var(--danger)]"
        onClick={() => {
          if (!window.confirm(`Remove ${name}? This client leaves the list, and uploaded files are deleted.`)) return;
          void removeClientAction(clientId).then((result) => {
            if (result?.error) setError(result.error);
          });
        }}
      >
        Remove
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

export function ClientActions({
  clientId,
  name,
  email,
  canDiscard,
  canRemove,
}: {
  clientId: string;
  name: string;
  email: string | null;
  canDiscard: boolean;
  canRemove: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {email ? (
        <Button
          onClick={() => {
            void sendPortalInviteAction(clientId).then((result) => {
              if (result?.error) setError(result.error);
              else setMessage("Invite queued.");
            });
          }}
        >
          Send portal invite
        </Button>
      ) : null}
      {canDiscard ? <Button onClick={() => void discardWizardAction(clientId)}>Discard draft</Button> : null}
      {canRemove ? <RemoveClientButton clientId={clientId} name={name} /> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
