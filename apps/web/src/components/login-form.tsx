"use client";

import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export function LoginForm({ notice }: { notice?: string | null }) {
  const [error, setError] = useState<string | null>(notice ?? null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (result.error) {
      if (result.error.status === 429) setError("Too many attempts. Try again later.");
      else if (result.error.status === 403) setError("This account cannot be used.");
      else setError("Email or password is incorrect.");
      return;
    }
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      return;
    }
    window.location.href = "/home";
  }

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link className="text-sm" href="/forgot-password">
        Forgot password
      </Link>
    </form>
  );
}
