"use client";

import { continueWizardAction, discardWizardAction, previewWizardPromptAction, saveDraftAction, submitWizardAction } from "@/app/admin/actions";
import { Button, ErrorText, Input } from "@/components/ui";
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

const STEPS = [
  { title: "Business and contact", intro: "Who the business is and how to reach the person setting this up." },
  { title: "Website notes", intro: "Nothing is fetched from the website yet. Write down what you learned on the call." },
  { title: "Plan", intro: "Choose the catalog plan. Setup-fee waiver is the only override on this step." },
  { title: "Coverage", intro: "When the receptionist should answer, and what to do when the office is closed or busy." },
  { title: "Features", intro: "Booking, messages, transfers, and the recall add-on. These are saved now and connected later." },
  { title: "Voice and personality", intro: "Voice previews are not connected yet. These choices are labels until then." },
  { title: "Knowledge base", intro: "Hours, services, FAQs, policies, and staff. You can also attach source files." },
  { title: "Phone setup", intro: "Record how the phone line should work. No number is purchased in this step." },
  { title: "Compliance", intro: "Dental and medical office are treated as healthcare. Submit stays blocked until that review is checked and noted." },
  { title: "Portal access", intro: "Store the owner email. Submit does not send the invite." },
  { title: "Review and submit", intro: "Confirm the summary. This does not call a voice, phone, or billing provider." },
] as const;

const KNOWLEDGE_LIMIT = 10_000;

function FieldLabel({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`About ${label}`}
          className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white text-[11px] font-semibold text-[var(--muted)]"
          onClick={() => setOpen((current) => !current)}
        >
          i
        </button>
      </div>
      {open ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
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
  const current = STEPS[step - 1];
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Step {step} of 11 — {current?.title}</h2>
        <p className="text-sm text-[var(--muted)]">{current?.intro} Drafts save automatically.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {step === 1 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Business name" hint="The name callers should hear and the name stored on the client record." />
            <Input value={business.name ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, name: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Name pronunciation (optional)" hint="How the receptionist should say the business name, such as uh-LIN-struh." />
            <Input value={business.namePronunciation ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, namePronunciation: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Industry" hint="Used for defaults. Dental and medical office are marked healthcare-sensitive unless you change that later." />
            <select className="w-full cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={business.industry ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, industry: event.target.value } })}>
              <option value="">Choose</option>
              {INDUSTRIES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel label="Contact name" hint="The person Alinstra will talk to about this account." />
            <Input value={business.contactName ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactName: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Contact email" hint="How to reach that person. This is not the portal login unless you use the same address on the portal step." />
            <Input value={business.contactEmail ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactEmail: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Phone" hint="The contact's phone number. This is not necessarily the line the receptionist will answer." />
            <Input value={business.contactPhone ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, contactPhone: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Street address (optional)" hint="Where customers visit. Leave this blank if you do not have it yet." />
            <Input value={business.addressLine1 ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, addressLine1: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Timezone" hint="IANA timezone used for hours, such as America/New_York. That is the default." />
            <Input value={business.timezone ?? "America/New_York"} onChange={(event) => setPayload({ ...payload, business: { ...business, timezone: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Website" hint="The public site, including https://. Nothing is downloaded from it in this wizard." />
            <Input value={business.websiteUrl ?? ""} onChange={(event) => setPayload({ ...payload, business: { ...business, websiteUrl: event.target.value } })} />
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Notes from the call" hint="Facts the business told you. Website import is not connected, so this is the only place those notes are stored." />
            <textarea className="min-h-28 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.websiteNotes ?? ""} onChange={(event) => setPayload({ ...payload, websiteNotes: event.target.value })} />
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Plan" hint="Starter, Professional, or Premium. This sets the monthly price and included minutes." />
            <select className="w-full cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.plan.planId ?? "")} onChange={(event) => setPayload({ ...payload, plan: { ...payload.plan, planId: event.target.value } })}>
              <option value="">Choose</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} (${(plan.monthlyPriceCents / 100).toFixed(0)}/mo)</option>
              ))}
            </select>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.plan.setupFeeWaived)} onChange={(event) => setPayload({ ...payload, plan: { ...payload.plan, setupFeeWaived: event.target.checked } })} />
            <FieldLabel label="Waive setup fee" hint="Check this when the one-time setup fee should not be charged." />
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-3">
          {(
            [
              ["unansweredAfterRings", "Rings before answering", "How many times the phone rings before the receptionist picks up. Enter a whole number from 1 to 20."],
              ["lunchHours", "Lunch hours", "When the office is at lunch, and what the receptionist should do with calls then."],
              ["afterHours", "After hours", "What should happen when someone calls outside open hours."],
              ["weekends", "Weekends", "How weekend calls should be handled."],
              ["holidays", "Holidays", "How holiday calls should be handled, including any days you close."],
              ["holdOverflow", "Hold and overflow", "What to do when every line is busy or a caller has been waiting."],
            ] as const
          ).map(([field, label, hint]) => (
            <div key={field}>
              <FieldLabel label={label} hint={hint} />
              <Input value={payload.coverage[field] ?? ""} onChange={(event) => setPayload({ ...payload, coverage: { ...payload.coverage, [field]: event.target.value } })} />
            </div>
          ))}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Booking mode" hint="Direct to calendar books a time. Request only takes a message for the office to confirm. Calendar booking is not connected yet." />
            <select className="w-full cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.features.bookingMode ?? "")} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, bookingMode: event.target.value } })}>
              <option value="">Choose</option>
              <option value="direct_calendar">Direct to calendar</option>
              <option value="request_only">Request only</option>
            </select>
          </div>
          <div>
            <FieldLabel label="Messages" hint="Who should get a text or email, and what those messages are for." />
            <Input value={String(payload.features.messages ?? "")} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, messages: event.target.value } })} />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.features.textConfirmations)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, textConfirmations: event.target.checked } })} />
            <FieldLabel label="Text confirmations" hint="Send the caller a text confirming what was booked or requested." />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.features.textReminders)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, textReminders: event.target.checked } })} />
            <FieldLabel label="Text reminders" hint="Send a reminder text before an appointment." />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.features.liveTransfer)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, liveTransfer: event.target.checked } })} />
            <FieldLabel label="Live transfer" hint="Allow the receptionist to transfer the caller to a person." />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.features.recallAddOn)} onChange={(event) => setPayload({ ...payload, features: { ...payload.features, recallAddOn: event.target.checked } })} />
            <FieldLabel label="Recall add-on" hint="Turn on recall reminders. The choice is stored now. Billing for it comes later." />
          </div>
        </div>
      ) : null}

      {step === 6 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Voice" hint="A placeholder until voice previews exist. No audio plays from this list." />
            <select className="w-full cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.voice.voiceId ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, voiceId: event.target.value } })}>
              <option value="">Choose</option>
              <option value="voice_1">Voice 1</option>
              <option value="voice_2">Voice 2</option>
              <option value="voice_3">Voice 3</option>
              <option value="voice_4">Voice 4</option>
            </select>
          </div>
          <div>
            <FieldLabel label="Greeting" hint="The first words the caller should hear, including the business name if you want it spoken." />
            <Input value={payload.voice.greeting ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, greeting: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Tone" hint="How the receptionist should sound, such as warm, brief, or formal." />
            <Input value={payload.voice.tone ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, tone: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Languages" hint="Languages the receptionist should be able to speak." />
            <Input value={payload.voice.languages ?? ""} onChange={(event) => setPayload({ ...payload, voice: { ...payload.voice, languages: event.target.value } })} />
          </div>
        </div>
      ) : null}

      {step === 7 ? (
        <div className="grid gap-3">
          {(
            [
              ["hours", "Hours", "When the business is open, including lunch, weekends, or seasonal exceptions."],
              ["services", "Services and prices", "What you offer and what it costs. Leave a price out if the receptionist should not quote it."],
              ["faqs", "FAQs", "Questions callers ask, each with the answer the receptionist should give."],
              ["policies", "Policies", "Cancellation, deposits, lateness, and any other rule the receptionist must follow."],
              ["staff", "Staff directory", "Names, roles, and who a call should be transferred to."],
            ] as const
          ).map(([field, label, hint]) => (
            <div key={field}>
              <FieldLabel label={label} hint={`${hint} Up to ${KNOWLEDGE_LIMIT.toLocaleString()} characters.`} />
              <textarea className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" maxLength={KNOWLEDGE_LIMIT} value={payload.knowledge[field] ?? ""} onChange={(event) => setPayload({ ...payload, knowledge: { ...payload.knowledge, [field]: event.target.value } })} />
            </div>
          ))}
          <div>
            <FieldLabel label="Files" hint="PDF, DOCX, TXT, or CSV. Up to 10 MB each, 25 files, and 50 MB total for this client. Text is extracted after upload." />
            <input className="cursor-pointer text-sm file:cursor-pointer" type="file" accept=".pdf,.docx,.txt,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          </div>
          <ul className="text-sm">
            {documents.map((document) => (
              <li key={document.id}>{document.originalFilename} — {document.extractionStatus}{document.extractionError ? ` (${document.extractionError})` : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 8 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Phone setup" hint="New number means Alinstra will provide one later. Forwarding means the existing line sends calls to the receptionist. Nothing is purchased here." />
            <select className="w-full cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={payload.phone.mode ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, mode: event.target.value } })}>
              <option value="">Choose</option>
              <option value="new_number">New number</option>
              <option value="forward">Forwarding</option>
            </select>
          </div>
          <div>
            <FieldLabel label="Carrier" hint="The phone company or phone system the business uses today." />
            <Input value={payload.phone.carrier ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, carrier: event.target.value } })} />
          </div>
          <div>
            <FieldLabel label="Current number" hint="The number callers use now." />
            <Input value={payload.phone.currentNumber ?? ""} onChange={(event) => setPayload({ ...payload, phone: { ...payload.phone, currentNumber: event.target.value } })} />
          </div>
        </div>
      ) : null}

      {step === 9 ? (
        <div className="grid gap-3">
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.compliance.healthcareSensitive)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, healthcareSensitive: event.target.checked, healthcareTouched: true, aiDisclosure: true } })} />
            <FieldLabel label="Healthcare or privacy-sensitive" hint="Checked automatically for dental and medical office. You can change it. When it is on, submit requires a completed review and a note." />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={payload.compliance.complianceReviewDone !== false && Boolean(payload.compliance.complianceReviewDone)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, complianceReviewDone: event.target.checked, aiDisclosure: true } })} />
            <FieldLabel label="Compliance review done" hint="Check this after you have reviewed what the receptionist is allowed to say." />
          </div>
          <div>
            <FieldLabel label="What was reviewed" hint="A short note of what you checked, such as the greeting, emergency script, or what must not be discussed." />
            <textarea className="min-h-20 w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm" value={String(payload.compliance.complianceReviewNote ?? "")} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, complianceReviewNote: event.target.value, aiDisclosure: true } })} />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input className="mt-0.5" type="checkbox" checked={Boolean(payload.compliance.recallConsent)} onChange={(event) => setPayload({ ...payload, compliance: { ...payload.compliance, recallConsent: event.target.checked, aiDisclosure: true } })} />
            <FieldLabel label="Recall consent confirmed" hint="The business confirmed it may send recall reminders to its customers." />
          </div>
        </div>
      ) : null}

      {step === 10 ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel label="Client owner email" hint="Saved on the client. Submit does not email them. Use Send portal invite on the client page when you are ready." />
            <Input value={payload.portalOwnerEmail ?? ""} onChange={(event) => setPayload({ ...payload, portalOwnerEmail: event.target.value })} />
          </div>
        </div>
      ) : null}

      {step === 11 ? (
        <div className="grid gap-2 text-sm">
          <p>Business: {business.name} ({business.industry})</p>
          <p>Owner email: {payload.portalOwnerEmail}</p>
          <PromptPreview clientId={clientId} payload={payload} />
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

function PromptPreview({ clientId, payload }: { clientId: string; payload: Payload }) {
  const [text, setText] = useState("Loading the prompt preview…");
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void previewWizardPromptAction({ clientId, payload }).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setText(result.error);
        setTruncated(false);
        return;
      }
      setText(result.prompt ?? "");
      setTruncated(Boolean(result.truncated));
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, payload]);
  return (
    <div className="grid gap-2">
      {truncated ? <p>Some reference material was cut to fit the prompt size limit.</p> : null}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] bg-[var(--card)] p-3 text-xs">{text}</pre>
    </div>
  );
}
