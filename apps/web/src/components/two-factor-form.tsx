"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useState, type FormEvent } from "react";

export function TwoFactorForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const result = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      setError("That code was not accepted.");
      return;
    }
    window.location.href = "/home";
  }

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="code">Authenticator code</Label>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}
