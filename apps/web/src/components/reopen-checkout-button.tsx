"use client";

import { reopenCheckoutAction } from "@/app/(marketing)/signup/actions";
import { Button, ErrorText } from "@/components/ui";
import { useState } from "react";

export function ReopenCheckoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void reopenCheckoutAction().then((result) => {
            setPending(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            window.location.href = result.url;
          });
        }}
      >
        {pending ? "Opening checkout…" : "Finish checkout"}
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
