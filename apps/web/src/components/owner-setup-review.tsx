"use client";

import { ownerSaveWizardDraftAction, ownerSubmitWizardAction } from "@/app/home/actions";
import { resendVerificationAction } from "@/app/(marketing)/signup/actions";
import { TransferTargetsEditor } from "@/components/transfer-targets-editor";
import { Button, Card, ErrorText } from "@/components/ui";
import { WeeklyHoursEditor } from "@/components/weekly-hours-editor";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WizardFormPayload } from "@/components/wizard-form";

/** Keep in sync with @alinstra/agent HOURS_CONFLICT_* (client must not import the db barrel). */
const HOURS_CONFLICT_REVIEW = "hours_conflict";
const HOURS_CONFLICT_MESSAGE = "Hours and after-hours/on-call times don't match — check them";

type PlanRow = { id: string; name: string; monthlyPriceCents: number };

function line(label: string, value: string | undefined | null, opts?: { required?: boolean }) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed && !opts?.required) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold text-[var(--ink)]">{label}: </span>
      {trimmed ? (
        <span className="text-[var(--body)]">{trimmed}</span>
      ) : (
        <span className="text-[var(--muted)]">Needs an answer</span>
      )}
    </p>
  );
}

export function OwnerSetupReview({
  clientId,
  emailVerified,
  initialUpdatedAt,
  initialPayload,
  plans,
  needsReviewQuestions = [],
}: {
  clientId: string;
  emailVerified: boolean;
  initialUpdatedAt: string;
  initialPayload: WizardFormPayload;
  plans: PlanRow[];
  needsReviewQuestions?: string[];
}) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState(false);
  const [transferError, setTransferError] = useState(false);

  const plan = plans.find((row) => row.id === payload.plan?.planId);
  const showHoursConflict = needsReviewQuestions.includes(HOURS_CONFLICT_REVIEW);

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
        {line("Business", payload.business?.name, { required: true })}
        {line("Contact", [payload.business?.contactName, payload.business?.contactEmail, payload.business?.contactPhone].filter(Boolean).join(" · "))}
        {line("Plan", plan ? `${plan.name} ($${(plan.monthlyPriceCents / 100).toFixed(0)}/mo)` : undefined)}
        {line("Hours", payload.knowledge?.hours, { required: true })}
        {line("Services", payload.knowledge?.services, { required: true })}
        {line("FAQs", payload.knowledge?.faqs, { required: true })}
        {line("Policies", payload.knowledge?.policies)}
        {line("After hours", payload.coverage?.afterHours, { required: true })}
        {line("Emergencies", typeof payload.features?.emergencyHandling === "string" ? payload.features.emergencyHandling : undefined, { required: true })}
        {line("Messages go to", String(payload.features?.messageRecipients ?? ""), { required: true })}
        {showHoursConflict ? <ErrorText>{HOURS_CONFLICT_MESSAGE}</ErrorText> : null}
        <p className="text-sm text-[var(--muted)]">
          Need changes?{" "}
          <a className="font-semibold underline" href="/home/business/interview">
            Continue the interview
          </a>
          .
        </p>
      </Card>

      <Card className="grid gap-3">
        <h2 className="text-lg font-extrabold">Business hours</h2>
        <WeeklyHoursEditor
          weeklyHoursText={String(payload.features?.weeklyHoursText ?? "")}
          knowledgeHours={payload.knowledge?.hours}
          onChange={(weeklyHoursText) =>
            setPayload((current) => ({
              ...current,
              features: { ...current.features, weeklyHoursText },
            }))
          }
          onValidityChange={setHoursError}
        />
      </Card>

      <Card className="grid gap-3">
        <h2 className="text-lg font-extrabold">Transfers</h2>
        <TransferTargetsEditor
          liveTransfer={Boolean(payload.features?.liveTransfer)}
          transferTargetsText={String(payload.features?.transferTargetsText ?? "")}
          transferNotes={String(payload.features?.transferNotes ?? "")}
          contactName={payload.business?.contactName}
          onLiveTransferChange={(liveTransfer) =>
            setPayload((current) => ({
              ...current,
              features: { ...current.features, liveTransfer },
            }))
          }
          onTargetsChange={(transferTargetsText) =>
            setPayload((current) => ({
              ...current,
              features: { ...current.features, transferTargetsText },
            }))
          }
          onValidityChange={setTransferError}
        />
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <p className="text-sm text-[var(--success-text)]">{note}</p> : null}

      <Button
        disabled={pending || !emailVerified || hoursError || transferError}
        onClick={() => void submit()}
      >
        {pending ? "Submitting…" : emailVerified ? "Launch Ava" : "Confirm your email to submit"}
      </Button>
      <p className="text-sm text-[var(--muted)]">
        Ava starts answering within a few minutes. You can change anything later from your dashboard.
      </p>
    </div>
  );
}
