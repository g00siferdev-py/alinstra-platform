import { ownerEditClientStepAction } from "@/app/home/actions";
import { WizardForm } from "@/components/wizard-form";
import { PageHeader } from "@/components/ui";
import { formPayload } from "@/lib/wizard-form-payload";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import {
  clientEditPayload,
  clients,
  knowledgeDocuments,
  OWNER_BLOCKED_STEP_HINT,
  OWNER_BLOCKED_STEPS,
  plans,
  wizardStepTitle,
} from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OwnerEditStepPage({ params }: { params: Promise<{ step: string }> }) {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1 || step > 10) notFound();
  if (OWNER_BLOCKED_STEPS.has(step)) {
    return (
      <main className="mx-auto grid max-w-2xl gap-6">
        <Link className="text-sm text-[var(--muted)]" href="/home/business">
          My business
        </Link>
        <PageHeader title={wizardStepTitle(step)} description={OWNER_BLOCKED_STEP_HINT} />
      </main>
    );
  }
  const actor = { id: session.user.id, role: "client_owner" as const, clientId: session.user.clientId };
  const client = await clients(actor).getById(session.user.clientId);
  if (!client?.wizardSubmittedAt) notFound();
  const [payload, planRows, documents] = await Promise.all([
    clientEditPayload(actor, session.user.clientId),
    plans(actor).list(),
    knowledgeDocuments(actor).list(session.user.clientId),
  ]);
  return (
    <main className="mx-auto grid max-w-2xl gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home/business">
        My business
      </Link>
      <PageHeader title={`Edit ${wizardStepTitle(step)}`} />
      <WizardForm
        clientId={client.id}
        mode="edit"
        initialStep={step}
        initialUpdatedAt={client.updatedAt.toISOString()}
        initialPayload={formPayload(payload, client.internal)}
        plans={planRows.map((plan) => ({ id: plan.id, name: plan.name, monthlyPriceCents: plan.monthlyPriceCents }))}
        documents={documents.map((document) => ({
          id: document.id,
          originalFilename: document.originalFilename,
          extractionStatus: document.extractionStatus,
          extractionError: document.extractionError,
        }))}
        provisioned={Boolean(client.retellAgentId)}
        saveEditStep={ownerEditClientStepAction}
        backHref="/home/business"
      />
    </main>
  );
}
