"use client";

import { signupAction, type SignupFormState } from "@/app/(marketing)/signup/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

/** Keep in sync with `MIN_PASSWORD_LENGTH` in `@alinstra/auth`. */
const MIN_PASSWORD_LENGTH = 12;

export function SignupForm({ planId }: { planId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(signupAction, null as SignupFormState);

  useEffect(() => {
    if (state?.ok && state.checkoutUrl) {
      window.location.href = state.checkoutUrl;
    }
  }, [state]);

  return (
    <form action={action} className="grid gap-4">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_url">Company website</label>
        <input id="company_url" name="company_url" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="planId" value={planId} />

      <div>
        <Label htmlFor="businessName">Business name</Label>
        <Input id="businessName" name="businessName" required maxLength={200} autoComplete="organization" />
      </div>
      <div>
        <Label htmlFor="ownerName">Your name</Label>
        <Input id="ownerName" name="ownerName" required maxLength={120} autoComplete="name" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required maxLength={200} autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="mobilePhone">Mobile phone</Label>
        <Input id="mobilePhone" name="mobilePhone" type="tel" required maxLength={40} autoComplete="tel" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-[var(--muted)]">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <label className="flex items-start gap-2 text-sm text-[var(--body)]">
        <input className="mt-1" type="checkbox" name="terms" value="true" required />
        <span>
          I agree to the{" "}
          <Link href="/legal#terms" className="font-semibold underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/legal#privacy" className="font-semibold underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {state && !state.ok ? (
        <ErrorText>
          {state.error}
          {state.existingAccount ? (
            <>
              {" "}
              <button type="button" className="underline" onClick={() => router.push("/login")}>
                Sign in
              </button>
            </>
          ) : null}
        </ErrorText>
      ) : null}

      <Button disabled={pending} type="submit">
        {pending ? "Creating your account…" : "Create account and pay"}
      </Button>
    </form>
  );
}
