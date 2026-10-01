"use client";

import { continueWizardAction, discardWizardAction, saveDraftAction, submitWizardAction } from "@/app/admin/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const INDUSTRIES = [
  ["hvac", "HVAC"],
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["veterinary", "Veterinary"],
  ["pet_grooming", "Pet grooming"],
  ["dental", "Dental"],
  ["medical_office", "Medical office"],
  ["salon_spa", "Salon / spa"],
  ["auto_repair", "Auto repair"],
  ["pest_control", "Pest control"],
  ["home_services", "Home services"],
  ["professional_services", "Professional services"],
  ["other", "Other"],
] as const;

const HEALTHCARE = new Set(["dental", "medical_office"]);

type Payload = {
  version: 1;
  business: Record<string, string>;
  websiteNotes?: string;
  plan: Record<string, string | boolean | null>;
  coverage: Record<string, string>;
  features: Record<string, string | boolean>;
  voice: Record<string, string>;
  knowledge: Record<string, string>;
  phone: Record<string, string>;
  compliance: Record<string, string | boolean>;
  portalOwnerEmail?: string;
};

type DocumentRow = { id: string; originalFilename: string; extractionStatus: string; extractionError: string | null };

function contentTypeFor(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "csv") return "text/csv";
  return "text/plain";
}

export function WizardForm({
  clientId,
  initialStep,
  initialUpdatedAt,
  initialPayload,
  plans,
  documents,
}: {
  clientId: string;
  initialStep: number;
  initialUpdatedAt: string;
  initialPayload: Payload;
  plans: { id: string; name: string; monthlyPriceCents: number }[];
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [payload, setPayload] = useState<Payload>(initialPayload);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const updatedRef = useRef(updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const saveLock = useRef(false);

  useEffect(() => {
    updatedRef.current = updatedAt;
  }, [updatedAt]);

  useEffect(() => {
    const industry = payload.business.industry;
    if (!industry || payload.compliance.healthcareTouched) return;
    if (HEALTHCARE.has(industry) && payload.compliance.healthcareSensitive !== true) {
      setPayload((current) => ({
        ...current,
        compliance: { ...current.compliance, healthcareSensitive: true, aiDisclosure: true },
      }));
    }
  }, [payload.business.industry, payload.compliance.healthcareTouched, payload.compliance.healthcareSensitive]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (saveLock.current) return;
      void saveDraftAction({ clientId, payload, currentStep: step, updatedAt: updatedRef.current }).then((result) => {
        if (result?.updatedAt) setUpdatedAt(result.updatedAt);
        if (result?.error?.includes("another tab")) setError(result.error);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [clientId, payload, step]);

  async function continueStep() {
    saveLock.current = true;
    setPending(true);
    const result = await continueWizardAction({ clientId, step, payload, updatedAt: updatedRef.current });
    setPending(false);
    if (result?.error) {
      saveLock.current = false;
      setError(result.error);
      return;
    }
    if (result?.updatedAt) {
      updatedRef.current = result.updatedAt;
      setUpdatedAt(result.updatedAt);
    }
    setError(null);
    setStep((current) => Math.min(11, current + 1));
    saveLock.current = false;
  }

  async function upload(file: File) {
    setError(null);
    const started = await fetch("/api/knowledge/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        filename: file.name,
        contentType: contentTypeFor(file.name),
        byteSize: file.size,
      }),
    });
    const body = (await started.json()) as { message?: string; mode?: string; url?: string; documentId?: string };
    if (!started.ok || !body.url || !body.documentId) {
      setError(body.message ?? "Upload failed.");
      return;
    }
    const stored = await fetch(body.url, {
      method: "PUT",
      headers: { "content-type": contentTypeFor(file.name) },
      body: file,
    });
    if (!stored.ok) {
      const failed = (await stored.json()) as { message?: string };
      setError(failed.message ?? "Upload failed.");
      return;
    }
    if (body.mode === "presigned") {
      const confirmed = await fetch(`/api/knowledge/uploads/${body.documentId}`, { method: "POST" });
      if (!confirmed.ok) {
        setError("Upload could not be confirmed.");
        return;
      }
    }
    router.refresh();
  }

  const business = payload.business;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-[var(--muted)]">Step {step} of 11. Drafts save automatically.</p>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {step === 1 ? (
        <div className="grid gap-3">
          <Label>Business name</Label>
          <Input value={business.name ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, name: event.target.value } })} />
          <Label>Industry</Label>
          <select className="rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={business.industry ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, industry: event.target.value } })}>
            <option value="">Choose</option>
            {INDUSTRIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Label>Contact name</Label>
          <Input value={business.contactName ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactName: event.target.value } })} />
          <Label>Contact email</Label>
          <Input value={business.contactEmail ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactEmail: event.target.value } })} />
          <Label>Phone</Label>
          <Input value={business.contactPhone ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactPhone: event.target.value } })} />
          <Label>Street address (optional)</Label>
          <Input value={business.addressLine1 ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, addressLine1: event.target.value } })} />
          <Label>Timezone</Label>
          <Input value={business.timezone ?? "America/New_York"} onChange={(event) => setPayload({ ...payload, business: { ...business, timezone: event.target.value } })} />
          <Label>Website</Label>
          <Input value={business.websiteUrl ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, websiteUrl: event.target.value } })} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3">
          <p className="text-sm">Website import arrives with demo mode. Nothing is fetched from the business website.</p>
          <Label>Notes from the call</Label>
          <textarea className="min-h-28 rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.websiteNotes ?? ""} onChange={(event) => setPayload({ ...payload, websiteNotes: event.target.value })} />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-3">
          <Label>Plan</Label>
          <select className="rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.plan.planId ?? "")} onChange={(event) => setPayload({ ...payload, plan: { ...payload.plan, planId: event.target.value } })}>
            <option value="">Choose</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name} (${(plan.monthlyPriceCents / 100).toFixed(0)}/mo)</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(payload.plan.setupFeeWaived)} onChange={(event) => setPayload({ ...payload, plan: { ...payload.plan, setupFeeWaived: event.target.checked } })} />
            Waive setup fee
          </label>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-3">
          {(["unansweredAfterRings", "lunchHours", "afterHours", "weekends", "holidays", "holdOverflow"] as const).map((field) => (
            <div key={field}>
              <Label>{field}</Label>
              <Input value={payload.coverage[field] ?? ""} onChange={(event) => setPayload({ ...payload, coverage: { ...payload.coverage, [field]: event.target.value } })} />
            </div>
          ))}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="grid gap-3">
          <Label>Booking mode</Label>
          <select className="rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.features.bookingMode ?? "")} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, bookingMode: event.target.value } })}>
            <option value="">Choose</option>
            <option value="direct_calendar">Direct to calendar</option>
            <option value="request_only">Request only</option>
          </select>
          <Label>Messages</Label>
          <Input value={String(payload.features.messages ?? "")} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, messages: event.target.value } })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(payload.features.textConfirmations)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, textConfirmations: event.target.checked } })} /> Text confirmations</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(payload.features.textReminders)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, textReminders: event.target.checked } })} /> Text reminders</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(payload.features.liveTransfer)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, liveTransfer: event.target.checked } })} /> Live transfer</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(payload.features.recallAddOn)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, recallAddOn: event.target.checked } })} /> Recall add-on</label>
        </div>
      ) : null}

      {step === 6 ? (
        <div className="grid gap-3">
          <p className="text-sm">Voice previews arrive with the voice provider. These labels are placeholders.</p>
          <Label>Voice</Label>
          <select className="rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.voice.voiceId ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, voiceId: event.target.value } })}>
            <option value="">Choose</option>
            <option value="voice_1">Voice 1</option>
            <option value="voice_2">Voice 2</option>
            <option value="voice_3">Voice 3</option>
            <option value="voice_4">Voice 4</option>
          </select>
          <Label>Greeting</Label>
          <Input value={payload.voice.greeting ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, greeting: event.target.value } })} />
          <Label>Tone</Label>
          <Input value={payload.voice.tone ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, tone: event.target.value } })} />
          <Label>Languages</Label>
          <Input value={payload.voice.languages ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, languages: event.target.value } })} />
        </div>
      ) : null}

      {step === 7 ? (
        <div className="grid gap-3">
          {(["hours", "services", "faqs", "policies", "staff"] as const).map((field) => (
            <div key={field}>
              <Label>{field}</Label>
              <textarea className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.knowledge[field] ?? ""} onChange={(event) => setPayload({ ...payload, knowledge: { ...payload.knowledge, [field]: event.target.value } })} />
            </div>
          ))}
          <Label>Files (PDF, DOCX, TXT, CSV, up to 10 MB)</Label>
          <input type="file" accept=".pdf,.docx,.txt,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <ul className="text-sm">
            {documents.map((document) => (
              <li key={document.id}>{document.originalFilename} — {document.extractionStatus}{document.extractionError ? ` (${document.extractionError})` : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 8 ? (
        <div className="grid gap-3">
          <p className="text-sm">Phone purchasing is not connected. This only stores what you enter.</p>
          <Label>Mode</Label>
          <select className="rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.phone.mode ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, mode: event.target.value } })}>
            <option value="">Choose</option>
            <option value="new_number">New number</option>
            <option value="forward">Forwarding</option>
          </select>
          <Label>Carrier</Label>
          <Input value={payload.phone.carrier ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, carrier: event.target.value } })} />
          <Label>Current number</Label>
          <Input value={payload.phone.currentNumber ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, currentNumber: event.target.value } })} />
        </div>
      ) : null}

      {step === 9 ? (
        <div className="grid gap-3">
          <p className="text-sm">AI disclosure stays on. There is no separate review queue yet.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(payload.compliance.healthcareSensitive)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, healthcareSensitive: event.target.checked, healthcareTouched: true, aiDisclosure: true } })} />
            Healthcare or privacy-sensitive
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={payload.compliance.complianceReviewDone !== false && Boolean(payload.compliance.complianceReviewDone)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, complianceReviewDone: event.target.checked, aiDisclosure: true } })} />
            Compliance review done
          </label>
          <Label>What was reviewed</Label>
          <textarea className="min-h-20 rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.compliance.complianceReviewNote ?? "")} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, complianceReviewNote: event.target.value, aiDisclosure: true } })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(payload.compliance.recallConsent)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, recallConsent: event.target.checked, aiDisclosure: true } })} />
            Recall consent confirmed
          </label>
        </div>
      ) : null}

      {step === 10 ? (
        <div className="grid gap-3">
          <p className="text-sm">Submit stores this email. It does not send the invite.</p>
          <Label>Client owner email</Label>
          <Input value={payload.portalOwnerEmail ?? ""} onChange={(event) => setPayload({ ...payload, portalOwnerEmail: event.target.value })} />
        </div>
      ) : null}

      {step === 11 ? (
        <div className="grid gap-2 text-sm">
          <p>Business: {business.name} ({business.industry})</p>
          <p>Owner email: {payload.portalOwnerEmail}</p>
          <p className="text-[var(--muted)]">The agent prompt is generated in a later phase. This submit does not call a voice, phone, or billing provider.</p>
          <Button disabled={pending} onClick={() => { saveLock.current = true; setPending(true); void submitWizardAction({ clientId, payload, updatedAt: updatedRef.current }).then((result) => { saveLock.current = false; setPending(false); if (result?.error) setError(result.error); }); }}>Submit wizard</Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step > 1 ? <Button onClick={() => setStep((current) => current - 1)}>Back</Button> : null}
        {step < 11 ? <Button disabled={pending} onClick={() => void continueStep()}>{pending ? "Saving…" : "Continue"}</Button> : null}
        <Button onClick={() => void discardWizardAction(clientId)}>Discard draft</Button>
      </div>
    </div>
  );
}
