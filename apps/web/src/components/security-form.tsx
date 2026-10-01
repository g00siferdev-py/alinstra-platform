"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useState, type FormEvent } from "react";

type EnableResult = { totpURI: string; backupCodes: string[] };

export function SecurityForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState<EnableResult | null>(null);
  const [done, setDone] = useState(false);

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.twoFactor.enable({ password });
    setPending(false);
    const data = result.data;
    if (result.error || !data || data.method !== "totp") {
      setError("Could not start two-factor setup. Check your password.");
      return;
    }
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
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
    setDone(true);
  }

  if (done) {
    return (
      <p className="text-sm">
        Two-factor authentication is on. <a href="/home">Continue</a>
      </p>
    );
  }

  if (!setup) {
    return (
      <form className="grid gap-3" onSubmit={onEnable}>
        <div>
          <Label htmlFor="password">Current password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Generate authenticator setup"}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm">Add this key to your authenticator app, then enter a code. Store the backup codes somewhere safe. They are shown once.</p>
      <p className="break-all rounded-md bg-[var(--bg)] p-3 text-xs">{setup.totpURI}</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
        {setup.backupCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <form className="grid gap-3" onSubmit={onVerify}>
        <div>
          <Label htmlFor="code">Code from the app</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Turn on two-factor"}
        </Button>
      </form>
    </div>
  );
}
