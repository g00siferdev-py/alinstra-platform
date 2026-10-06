"use client";

import { ownerSaveWizardDraftAction, ownerSubmitWizardAction } from "@/app/home/actions";
import { resendVerificationAction } from "@/app/(marketing)/signup/actions";
import { Button, Card, ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WizardFormPayload } from "@/components/wizard-form";

type PlanRow = { id: string; name: string; monthlyPriceCents: number };

function line(label: string, value: string | undefined | null) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold text-[var(--ink)]">{label}: </span>
      <span className="text-[var(--body)]">{value}</span>
    </p>
  );
}

export function OwnerSetupReview({
  clientId,
  emailVerified,
  initialUpdatedAt,
  initialPayload,
  plans,
}: {
  clientId: string;
  emailVerified: boolean;
  initialUpdatedAt: string;
  initialPayload: WizardFormPayload;
  plans: PlanRow[];
}) {
  const router = useRouter();
  const [payload] = useState(initialPayload);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const plan = plans.find((row) => row.id === payload.plan?.planId);

  async function submit() {
    setPending(true);
    setError(null);
    setNote(null);
    const saved = await ownerSaveWizardDraftAction({
      clientId,
      payload,
      currentStep: 11,
      updatedAt,
    });
    if (saved?.error) {
      setPending(false);
      setError(saved.error);
      return;
    }
    if (saved?.updatedAt) setUpdatedAt(saved.updatedAt);
    const result = await ownerSubmitWizardAction({
      clientId,
      payload,
      updatedAt: saved?.updatedAt ?? updatedAt,
    });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.push("/home?welcome=1");
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {!emailVerified ? (
        <Card className="grid gap-3">
          <p className="font-bold text-[var(--ink)]">Confirm your email to submit</p>
          <p className="text-sm text-[var(--muted)]">
            We sent a confirmation link. Checkout can finish without it, but review submit waits until your email is
            verified.
          </p>
          <Button
            variant="secondary"
            disabled={resending}
            onClick={() => {
              setResending(true);
              setNote(null);
              void resendVerificationAction().then((result) => {
                setResending(false);
                if (!result.ok) setError(result.error);
                else setNote("Confirmation email sent.");
              });
            }}
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </Button>
        </Card>
      ) : null}

      <Card className="grid gap-3">
        <h2 className="text-lg font-extrabold">Review your setup</h2>
        {line("Business", payload.business?.name)}
        {line("Contact", [payload.business?.contactName, payload.business?.contactEmail, payload.business?.contactPhone].filter(Boolean).join(" · "))}
        {line("Plan", plan ? `${plan.name} ($${(plan.monthlyPriceCents / 100).toFixed(0)}/mo)` : undefined)}
        {line("Hours", payload.knowledge?.hours)}
        {line("Services", payload.knowledge?.services)}
        {line("Policies", payload.knowledge?.policies)}
        {line("Messages go to", String(payload.features?.messageRecipients ?? ""))}
        <p className="text-sm text-[var(--muted)]">
          Need changes?{" "}
          <a className="font-semibold underline" href="/home/business/interview">
            Continue the interview
          </a>
          .
        </p>
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <p className="text-sm text-[var(--success-text)]">{note}</p> : null}

      <Button disabled={pending || !emailVerified} onClick={() => void submit()}>
        {pending ? "Submitting…" : emailVerified ? "Submit for review" : "Confirm your email to submit"}
      </Button>
    </div>
  );
}
