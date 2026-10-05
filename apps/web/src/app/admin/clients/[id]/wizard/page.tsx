import { WizardForm } from "@/components/wizard-form";
import { interviewEnabled } from "@/lib/interview-config";
import { formPayload } from "@/lib/wizard-form-payload";
import {
  clientEditPayload,
  clients,
  emptyWizardPayload,
  knowledgeDocuments,
  plans,
  wizardDrafts,
  wizardPayloadSchema,
} from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

function stepFrom(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 11 ? parsed : 1;
}

export default async function WizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string | string[]; mode?: string | string[] }>;
}) {
  const session = await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const editMode = (Array.isArray(query.mode) ? query.mode[0] : query.mode) === "edit" && Boolean(client.wizardSubmittedAt);
  const [planRows, documents] = await Promise.all([
    plans({ role: "admin" }).list(),
    knowledgeDocuments({ role: "admin" }).list(id),
  ]);
  const shared = {
    clientId: id,
    plans: planRows.map((plan) => ({ id: plan.id, name: plan.name, monthlyPriceCents: plan.monthlyPriceCents })),
    documents: documents.map((document) => ({
      id: document.id,
      originalFilename: document.originalFilename,
      extractionStatus: document.extractionStatus,
      extractionError: document.extractionError,
    })),
  };

  if (editMode) {
    // Edit mode reads the client record, never the WizardDraft, which stops being current after submit.
    const payload = await clientEditPayload({ role: "admin", id: session.user.id }, id);
    return (
      <main className="mx-auto grid max-w-2xl gap-4 p-6">
        <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>{client.name}</Link>
        <h1 className="text-2xl font-semibold">Edit {client.name}</h1>
        <WizardForm
          {...shared}
          mode="edit"
          initialStep={stepFrom(query.step)}
          initialUpdatedAt={client.updatedAt.toISOString()}
          initialPayload={formPayload(payload, client.internal)}
          hasStripeSubscription={Boolean(client.stripeSubscriptionId)}
          provisioned={Boolean(client.retellAgentId)}
        />
      </main>
    );
  }

  const draft = await wizardDrafts({ role: "admin" }).getByClientId(id);
  if (!draft) notFound();
  const parsed = wizardPayloadSchema.safeParse(draft.payload);
  const payload = parsed.success ? parsed.data : emptyWizardPayload();
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>{client.name}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Wizard · {client.name}</h1>
        {interviewEnabled() ? (
          <Link className="text-sm underline" href={`/admin/clients/${id}/interview`}>
            Start with an interview
          </Link>
        ) : null}
      </div>
      <WizardForm
        {...shared}
        initialStep={stepFrom(query.step) || draft.currentStep}
        initialUpdatedAt={draft.updatedAt.toISOString()}
        initialPayload={formPayload(payload, client.internal)}
      />
    </main>
  );
}
