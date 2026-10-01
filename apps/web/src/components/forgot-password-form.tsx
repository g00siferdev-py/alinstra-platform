"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useState, type FormEvent } from "react";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "Too many reset requests. Try again later." : "Could not send a reset email.");
      return;
    }
    setMessage("If an account exists for that email, a reset link is on its way.");
  }

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
