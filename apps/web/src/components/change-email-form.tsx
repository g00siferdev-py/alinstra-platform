"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input } from "@/components/ui";
import { useState } from "react";

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.changeEmail({
      newEmail: email.trim(),
      callbackURL: "/account",
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not start the email change.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return <p className="text-sm">Check {email.trim()} for a confirmation link. The login stays {currentEmail} until that link is opened.</p>;
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1 text-sm" htmlFor="new-email">
        New login email
        <Input id="new-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button disabled={pending} type="submit">{pending ? "Sending…" : "Send confirmation"}</Button>
    </form>
  );
}
