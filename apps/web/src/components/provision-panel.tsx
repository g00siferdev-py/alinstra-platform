"use client";

import {
  approveNumberPurchaseAction,
  createClientZeroAction,
  endServiceNowAction,
  refreshPaymentLinkAction,
  retrySyncAction,
  saveTransferTargetsAction,
  scheduleChurnAction,
  startProvisioningAction,
} from "@/app/admin/provision-actions";
import { CopyButton } from "@/components/copy-button";
import { useToast } from "@/components/toast";
import { Button, ErrorText } from "@/components/ui";
import { AWAITING_APPROVAL, numberCostText, numberKindText, provisionHeadline, type NumberPurchaseView, type ProvisionStepView } from "@/lib/provision-view";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type { NumberPurchaseView, ProvisionStepView } from "@/lib/provision-view";

export function CreateClientZeroButton() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button tone="secondary" onClick={() => {
        void createClientZeroAction().then((result) => {
          if ("error" in result && result.error) {
            setError(result.error);
            toast.error("Could not create client zero", result.error);
          } else {
            toast.success("Client zero is ready");
            router.push(`/admin/clients/${result.id}`);
          }
        });
      }}>Create client zero</Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

export function ProvisionPanel({
  clientId,
  status,
  syncStatus,
  syncError,
  checkoutUrl,
  billingStatus,
  phone,
  phoneDisplay,
  targets,
  internal,
  steps,
  runStatus,
  runKind,
  numberApproved,
  numberPurchase,
  voiceName,
  appEnv = "",
}: {
  clientId: string;
  status: string;
  syncStatus: string;
  syncError: string | null;
  checkoutUrl: string | null;
  billingStatus: string;
  phone: string | null;
  phoneDisplay: string | null;
  targets: string;
  internal: boolean;
  steps: ProvisionStepView[];
  runStatus: string | null;
  runKind: string | null;
  numberApproved: boolean;
  numberPurchase: NumberPurchaseView;
  voiceName: string;
  /** From APP_ENV; non-production shows an extra staging warning on confirm. */
  appEnv?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmNumber, setConfirmNumber] = useState<"start" | "approve" | null>(null);
  const [confirmProvision, setConfirmProvision] = useState(false);
  const syncLabel = syncStatus === "in_sync" ? "In sync" : syncStatus === "syncing" ? "Syncing" : syncStatus === "failed" ? "Sync failed — retry" : "Not on Retell yet";
  const awaitingApproval = steps.some((step) => step.status === AWAITING_APPROVAL);
  const polling = (runStatus === "running" && !awaitingApproval) || syncStatus === "syncing";
  const headline = provisionHeadline({ status, phoneDisplay, runStatus, runKind, steps });
  const needsNumber = !phone;
  const isProduction = appEnv === "production";

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [polling, router]);

  async function run(label: string, action: () => Promise<{ error?: string }>, successDetail?: string) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (result.error) {
      setError(result.error);
      toast.error(`${label} failed`, result.error);
    } else {
      toast.success(label, successDetail);
    }
    router.refresh();
  }

  function startProvisioning() {
    // Always confirm: Retell has no test mode, so this buys a real number on Alinstra's account.
    setConfirmProvision(true);
  }

  function confirmAndProvision() {
    setConfirmProvision(false);
    void run("Provisioning started", () => startProvisioningAction(clientId, { numberApproved: numberApproved || needsNumber }));
  }

  const toneClass =
    headline.tone === "live" ? "text-[var(--accent)]" : headline.tone === "failed" ? "text-[var(--danger)]" : headline.tone === "running" ? "" : "text-[var(--muted)]";

  return (
    <section className="grid gap-3 rounded-xl border border-[var(--line)] p-4 text-sm">
      <div className="grid gap-1">
        <p className={`text-xl font-semibold ${toneClass}`} aria-live="polite">{headline.text}</p>
        {phone ? (
          <div className="flex flex-wrap items-center gap-2 text-[var(--muted)]">
            <span>{phone}</span>
            <CopyButton value={phone} label="E.164" />
          </div>
        ) : null}
        <p>Retell: {syncLabel} · Voice: {voiceName}</p>
        <p>Billing: {internal ? "Client zero, not billed" : billingStatus}</p>
      </div>
      {syncError ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--danger)]">Sync error</span>
            <CopyButton value={syncError} label="error" />
          </div>
          <pre className="max-h-48 overflow-auto rounded-md border border-[var(--line)] bg-[var(--card)] p-2 text-xs break-words whitespace-pre-wrap select-all">{syncError}</pre>
        </div>
      ) : null}
      {headline.error ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--danger)]">Provider error</span>
            <CopyButton value={headline.error} label="error" />
          </div>
          <pre className="max-h-64 overflow-auto rounded-md border border-[var(--danger)] bg-white p-2 text-xs break-words whitespace-pre-wrap select-all">{headline.error}</pre>
        </div>
      ) : null}
      {steps.length > 0 ? (
        <ol className="grid gap-1">
          {steps.map((step, index) => (
            <li key={step.name} className="flex items-center gap-2">
              <span className="w-5 text-[var(--muted)]">{index + 1}.</span>
              <span>{step.label}</span>
              <span className={step.status === "failed" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>· {step.status === AWAITING_APPROVAL ? "waiting for approval" : step.status}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {awaitingApproval ? (
        <div className="grid gap-2 rounded-md border border-[var(--accent)] p-3">
          <p>{numberCostText(numberPurchase)}</p>
          <div>
            <Button disabled={pending} onClick={() => setConfirmNumber("approve")}>Approve and buy number</Button>
          </div>
        </div>
      ) : null}
      {checkoutUrl && billingStatus !== "paid" ? <a href={checkoutUrl}>Payment link</a> : null}
      {!internal && billingStatus !== "paid" ? (
        <Button tone="secondary" disabled={pending} onClick={() => void run("New payment link created", () => refreshPaymentLinkAction(clientId))}>New payment link</Button>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap gap-2">
        {runStatus === "failed" && runKind === "provision" ? (
          <Button disabled={pending || confirmProvision} onClick={startProvisioning}>Retry provisioning</Button>
        ) : status !== "live" && status !== "churned" ? (
          <Button disabled={pending || confirmProvision || runStatus === "running"} onClick={startProvisioning}>
            Start provisioning
          </Button>
        ) : null}
        {syncStatus === "failed" || syncStatus === "syncing" || status === "live" ? (
          <Button tone="secondary" disabled={pending} onClick={() => void run("Retell sync finished", () => retrySyncAction(clientId))}>
            {syncStatus === "failed" ? "Retry sync" : "Sync now"}
          </Button>
        ) : null}
        <Button tone="secondary" disabled={pending || internal} onClick={() => void run("End of service scheduled", () => scheduleChurnAction(clientId))}>End at period end</Button>
        <Button tone="danger" disabled={pending} onClick={() => {
          if (!window.confirm("End service now? The number, agent, and subscription stop immediately.")) return;
          void run("Service ended", () => endServiceNowAction(clientId));
        }}>End service now</Button>
      </div>
      {confirmProvision ? (
        <div className="grid gap-2 rounded-md border border-[var(--danger-text)] bg-[var(--danger-soft)] p-3">
          <p>
            This creates a live Retell agent and <strong>buys a real phone number</strong> on Alinstra&apos;s Retell
            account (about $2/month). Continue?
          </p>
          {!isProduction ? (
            <p className="text-[var(--muted)]">This is staging. Only provision a test client on purpose.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={pending} onClick={confirmAndProvision}>
              Buy number and provision
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmProvision(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <form className="grid gap-2" onSubmit={(event) => event.preventDefault()}>
        <label className="font-medium" htmlFor="targets">Transfer targets</label>
        <textarea id="targets" name="targets" className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={targets} />
        <Button tone="secondary" disabled={pending} onClick={(event) => {
          const form = (event.currentTarget as HTMLButtonElement).form;
          const text = String(new FormData(form ?? undefined).get("targets") ?? "");
          void run("Transfer targets saved", () => saveTransferTargetsAction(clientId, text));
        }}>Save targets</Button>
      </form>
      {confirmNumber ? (
        <div role="dialog" aria-modal="true" aria-labelledby="number-modal-title" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
          <div className="grid w-full max-w-md gap-3 rounded-xl border border-[var(--line)] bg-white p-5 shadow-lg">
            <h2 id="number-modal-title" className="text-lg font-semibold">
              Buy {numberKindText(numberPurchase)}
            </h2>
            <p>{numberCostText(numberPurchase)}</p>
            <p className="text-[var(--muted)]">Nothing is purchased until you confirm here. Cancel leaves the run waiting at this step.</p>
            <div className="flex justify-end gap-2">
              <Button tone="secondary" disabled={pending} onClick={() => setConfirmNumber(null)}>Cancel</Button>
              <Button
                disabled={pending}
                onClick={() => {
                  const mode = confirmNumber;
                  setConfirmNumber(null);
                  if (mode === "approve") void run("Number purchase approved", () => approveNumberPurchaseAction(clientId), "Provisioning resumes now.");
                  else void run("Provisioning started", () => startProvisioningAction(clientId, { numberApproved: true }), "The number will be bought when the run reaches that step.");
                }}
              >
                Confirm and buy
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
