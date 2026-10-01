"use client";

import { discardWizardAction, sendPortalInviteAction } from "@/app/admin/actions";
import { Button, ErrorText } from "@/components/ui";
import { useState } from "react";

export function ClientActions({
  clientId,
  email,
  canDiscard,
}: {
  clientId: string;
  email: string | null;
  canDiscard: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {email ? (
        <Button
          onClick={() => {
            void sendPortalInviteAction(clientId, email).then((result) => {
              if (result?.error) setError(result.error);
              else setMessage("Invite queued.");
            });
          }}
        >
          Send portal invite
        </Button>
      ) : null}
      {canDiscard ? <Button onClick={() => void discardWizardAction(clientId)}>Discard draft</Button> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
