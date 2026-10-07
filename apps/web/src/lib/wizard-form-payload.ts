import type { WizardFormPayload } from "@/components/wizard-form";
import type { WizardPayload } from "@alinstra/db";
import { CALL_RETENTION_DEFAULT_DAYS } from "@/lib/call-retention";
import { CALL_TIMING_DEFAULTS, DEFAULT_VOICE_KEY } from "@alinstra/providers";

/** Turns a parsed payload into the all-strings shape the form edits. Shared by admin and owner edit pages. */
export function formPayload(parsed: WizardPayload, internal: boolean): WizardFormPayload {
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
      transferNotes: parsed.features?.transferNotes ?? "",
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
      callRetentionDays: parsed.compliance?.callRetentionDays ?? CALL_RETENTION_DEFAULT_DAYS,
    },
    portalOwnerEmail: parsed.portalOwnerEmail ?? "",
  };
}
