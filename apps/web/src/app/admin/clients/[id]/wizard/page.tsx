import { WizardForm } from "@/components/wizard-form";
import {
  clientEditPayload,
  clients,
  emptyWizardPayload,
  knowledgeDocuments,
  plans,
  wizardDrafts,
  wizardPayloadSchema,
  type WizardPayload,
} from "@alinstra/db";
import { CALL_TIMING_DEFAULTS, DEFAULT_VOICE_KEY } from "@alinstra/providers";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

type FormPayload = Parameters<typeof WizardForm>[0]["initialPayload"];

/** Turns a parsed payload into the all-strings shape the form edits. */
function formPayload(parsed: WizardPayload, internal: boolean): FormPayload {
  return {
    version: 1,
    business: {
      timezone: parsed.business?.timezone ?? "America/New_York",
      name: parsed.business?.name ?? "",
      namePronunciation: parsed.business?.namePronunciation ?? "",
      industry: parsed.business?.industry ?? "",
      contactName: parsed.business?.contactName ?? "",
      contactEmail: parsed.business?.contactEmail ?? "",
      contactPhone: parsed.business?.contactPhone ?? "",
      addressLine1: parsed.business?.addressLine1 ?? "",
      websiteUrl: parsed.business?.websiteUrl ?? "",
      publicPhone: parsed.business?.publicPhone ?? "",
      publicEmail: parsed.business?.publicEmail ?? "",
    },
    websiteNotes: parsed.websiteNotes ?? "",
    plan: {
      planId: parsed.plan?.planId ?? "",
      setupFeeWaived: parsed.plan?.setupFeeWaived ?? false,
    },
    coverage: {
      unansweredAfterRings: parsed.coverage?.unansweredAfterRings ? String(parsed.coverage.unansweredAfterRings) : "",
      lunchHours: parsed.coverage?.lunchHours ?? "",
      afterHours: parsed.coverage?.afterHours ?? "",
      weekends: parsed.coverage?.weekends ?? "",
      holidays: parsed.coverage?.holidays ?? "",
      holdOverflow: parsed.coverage?.holdOverflow ?? "",
      callTiming: {
        maxCallMinutes: String(parsed.coverage?.callTiming?.maxCallMinutes ?? CALL_TIMING_DEFAULTS.maxCallMinutes),
        silenceSeconds: String(parsed.coverage?.callTiming?.silenceSeconds ?? CALL_TIMING_DEFAULTS.silenceSeconds),
        reminderSeconds: String(parsed.coverage?.callTiming?.reminderSeconds ?? CALL_TIMING_DEFAULTS.reminderSeconds),
      },
    },
    features: {
      bookingMode: parsed.features?.bookingMode ?? "",
      messages: parsed.features?.messages ?? "",
      messageRecipients: parsed.features?.messageRecipients ?? "",
      weeklyHoursText: parsed.features?.weeklyHoursText ?? "",
      transferTargetsText: parsed.features?.transferTargetsText ?? "",
      emergencyHandling: parsed.features?.emergencyHandling ?? "",
      textConfirmations: Boolean(parsed.features?.textConfirmations),
      textReminders: Boolean(parsed.features?.textReminders),
      liveTransfer: Boolean(parsed.features?.liveTransfer),
      recallAddOn: Boolean(parsed.features?.recallAddOn),
    },
    voice: {
      voiceId: parsed.voice?.voiceId ?? DEFAULT_VOICE_KEY,
      greeting: parsed.voice?.greeting ?? "",
      assistantName: parsed.voice?.assistantName ?? "Ava",
      disclosureMode: parsed.voice?.disclosureMode ?? "on_request",
      tone: parsed.voice?.tone ?? "",
      languages: parsed.voice?.languages ?? "",
    },
    knowledge: {
      hours: parsed.knowledge?.hours ?? "",
      services: parsed.knowledge?.services ?? "",
      faqs: parsed.knowledge?.faqs ?? "",
      policies: parsed.knowledge?.policies ?? "",
      staff: parsed.knowledge?.staff ?? "",
    },
    phone: {
      mode: parsed.phone?.mode ?? "",
      carrier: parsed.phone?.carrier ?? "",
      currentNumber: parsed.phone?.currentNumber ?? "",
      areaCode: parsed.phone?.areaCode ?? "",
      tollFree: parsed.phone?.tollFree ?? internal,
    },
    compliance: {
      aiDisclosure: true,
      recordingNotice: parsed.compliance?.recordingNotice ?? true,
      healthcareSensitive: Boolean(parsed.compliance?.healthcareSensitive),
      healthcareTouched: Boolean(parsed.compliance?.healthcareTouched),
      complianceReviewDone: Boolean(parsed.compliance?.complianceReviewDone),
      complianceReviewNote: parsed.compliance?.complianceReviewNote ?? "",
      recallConsent: Boolean(parsed.compliance?.recallConsent),
    },
    portalOwnerEmail: parsed.portalOwnerEmail ?? "",
  };
}

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
  const parsed = wizardPayloadSchema.parse(draft.payload ?? emptyWizardPayload());
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-6">
      <h1 className="text-2xl font-semibold">Add client</h1>
      <WizardForm
        {...shared}
        mode="create"
        initialStep={draft.currentStep}
        initialUpdatedAt={draft.updatedAt.toISOString()}
        initialPayload={formPayload(parsed, client.internal)}
      />
    </main>
  );
}
