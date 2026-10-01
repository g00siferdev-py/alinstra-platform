"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useState, type FormEvent } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (result.error) {
      setError("This reset link is invalid or expired.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p className="text-sm">
        Password updated. <a href="/login">Sign in</a>
      </p>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
