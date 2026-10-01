"use client";

import { acceptInviteAction, type ActionState } from "@/app/actions";
import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState, useState } from "react";

export function AcceptInviteForm({ token }: { token: string }) {
  const [pendingSignIn, setPendingSignIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await acceptInviteAction(prev, formData);
    if (next?.ok && next.email) {
      setPendingSignIn(true);
      const password = String(formData.get("password") ?? "");
      const result = await authClient.signIn.email({ email: next.email, password });
      setPendingSignIn(false);
      if (result.error) {
        setSignInError("Account created. Sign in from the login page.");
        return next;
      }
      window.location.href = "/home";
    }
    return next;
  }, null);

  return (
    <form className="grid gap-3" action={action}>
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
      </div>
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {signInError ? <ErrorText>{signInError}</ErrorText> : null}
      <Button type="submit" disabled={pending || pendingSignIn}>
        {pending || pendingSignIn ? "Creating account…" : "Accept invite"}
      </Button>
    </form>
  );
}
