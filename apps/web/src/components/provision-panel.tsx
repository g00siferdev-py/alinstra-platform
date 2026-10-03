"use client";

import {
  createClientZeroAction,
  endServiceNowAction,
  refreshPaymentLinkAction,
  retrySyncAction,
  saveTransferTargetsAction,
  scheduleChurnAction,
  startProvisioningAction,
} from "@/app/admin/provision-actions";
import { Button, ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateClientZeroButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button tone="secondary" onClick={() => {
        void createClientZeroAction().then((result) => {
          if ("error" in result && result.error) setError(result.error);
          else router.push(`/admin/clients/${result.id}`);
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
  targets,
  internal,
}: {
  clientId: string;
  status: string;
  syncStatus: string;
  syncError: string | null;
  checkoutUrl: string | null;
  billingStatus: string;
  phone: string | null;
  targets: string;
  internal: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const syncLabel = syncStatus === "in_sync" ? "In sync" : syncStatus === "syncing" ? "Syncing" : syncStatus === "failed" ? "Sync failed — retry" : "Not on Retell yet";

  async function run(action: () => Promise<{ error?: string }>) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (result.error) setError(result.error);
    router.refresh();
  }

  return (
    <section className="grid gap-3 rounded-xl border border-[var(--line)] p-4 text-sm">
      <h2 className="font-medium">Provisioning</h2>
      <p>Status: {status}{phone ? ` · ${phone}` : ""}</p>
      <p>Billing: {internal ? "Client zero, not billed" : billingStatus}</p>
      <p>Retell: {syncLabel}{syncError ? ` · ${syncError}` : ""}</p>
      {checkoutUrl && billingStatus !== "paid" ? <a href={checkoutUrl}>Payment link</a> : null}
      {!internal && billingStatus !== "paid" ? (
        <Button tone="secondary" disabled={pending} onClick={() => void run(() => refreshPaymentLinkAction(clientId))}>New payment link</Button>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void run(() => startProvisioningAction(clientId))}>Start provisioning</Button>
        {syncStatus === "failed" || syncStatus === "syncing" ? (
          <Button tone="secondary" disabled={pending} onClick={() => void run(() => retrySyncAction(clientId))}>Retry sync</Button>
        ) : null}
        <Button tone="secondary" disabled={pending || internal} onClick={() => void run(() => scheduleChurnAction(clientId))}>End at period end</Button>
        <Button tone="danger" disabled={pending} onClick={() => {
          if (!window.confirm("End service now? The number, agent, and subscription stop immediately.")) return;
          void run(() => endServiceNowAction(clientId));
        }}>End service now</Button>
      </div>
      <form className="grid gap-2" onSubmit={(event) => event.preventDefault()}>
        <label className="font-medium" htmlFor="targets">Transfer targets</label>
        <textarea id="targets" name="targets" className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" defaultValue={targets} />
        <Button tone="secondary" disabled={pending} onClick={(event) => {
          const form = (event.currentTarget as HTMLButtonElement).form;
          const text = String(new FormData(form ?? undefined).get("targets") ?? "");
          void run(() => saveTransferTargetsAction(clientId, text));
        }}>Save targets</Button>
      </form>
    </section>
  );
}
