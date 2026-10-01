import { WizardForm } from "@/components/wizard-form";
import { emptyWizardPayload, knowledgeDocuments, plans, wizardDrafts, wizardPayloadSchema } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function WizardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const draft = await wizardDrafts({ role: "admin" }).getByClientId(id);
  if (!draft) notFound();
  const parsed = wizardPayloadSchema.parse(draft.payload ?? emptyWizardPayload());
  const [planRows, documents] = await Promise.all([
    plans({ role: "admin" }).list(),
    knowledgeDocuments({ role: "admin" }).list(id),
  ]);
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-6">
      <h1 className="text-2xl font-semibold">Add client</h1>
      <WizardForm
        clientId={id}
        initialStep={draft.currentStep}
        initialUpdatedAt={draft.updatedAt.toISOString()}
        plans={planRows.map((plan) => ({ id: plan.id, name: plan.name, monthlyPriceCents: plan.monthlyPriceCents }))}
        documents={documents.map((document) => ({
          id: document.id,
          originalFilename: document.originalFilename,
          extractionStatus: document.extractionStatus,
          extractionError: document.extractionError,
        }))}
        initialPayload={{
          version: 1,
          business: {
            timezone: "America/New_York",
            name: parsed.business?.name ?? "",
            industry: parsed.business?.industry ?? "",
            contactName: parsed.business?.contactName ?? "",
            contactEmail: parsed.business?.contactEmail ?? "",
            contactPhone: parsed.business?.contactPhone ?? "",
            addressLine1: parsed.business?.addressLine1 ?? "",
            websiteUrl: parsed.business?.websiteUrl ?? "",
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
          },
          features: {
            bookingMode: parsed.features?.bookingMode ?? "",
            messages: parsed.features?.messages ?? "",
            textConfirmations: Boolean(parsed.features?.textConfirmations),
            textReminders: Boolean(parsed.features?.textReminders),
            liveTransfer: Boolean(parsed.features?.liveTransfer),
            recallAddOn: Boolean(parsed.features?.recallAddOn),
          },
          voice: {
            voiceId: parsed.voice?.voiceId ?? "",
            greeting: parsed.voice?.greeting ?? "",
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
          },
          compliance: {
            aiDisclosure: true,
            healthcareSensitive: Boolean(parsed.compliance?.healthcareSensitive),
            healthcareTouched: Boolean(parsed.compliance?.healthcareTouched),
            complianceReviewDone: Boolean(parsed.compliance?.complianceReviewDone),
            complianceReviewNote: parsed.compliance?.complianceReviewNote ?? "",
            recallConsent: Boolean(parsed.compliance?.recallConsent),
          },
          portalOwnerEmail: parsed.portalOwnerEmail ?? "",
        }}
      />
    </main>
  );
}
