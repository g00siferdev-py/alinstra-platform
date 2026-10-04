import { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { createDraftAgentConfig, rebuildAgentConfig } from "./agent";
import { recordChange, type Actor } from "./changes";
import {
  AGENT_AFFECTING_STEPS,
  businessSchema,
  clientCanBeRemoved,
  complianceSchema,
  OWNER_BLOCKED_STEP_HINT,
  OWNER_BLOCKED_STEPS,
  coverageSchema,
  emptyWizardPayload,
  featuresSchema,
  formatTransferTargets,
  formatWeeklyHours,
  healthcareRequired,
  INDUSTRIES,
  parseRecipientEmails,
  parseTransferTargets,
  parseWeeklyHours,
  knowledgeFieldsSchema,
  phoneSchema,
  planSelectionSchema,
  voiceSchema,
  wizardPayloadSchema,
  wizardStepTitle,
  type WeeklyHours,
  type WizardPayload,
} from "./domain";
import { changeLogFields, diffSection, SECTION_BY_STEP, type FieldChange } from "./edit-diff";
import { OWNER_STEP_HOLD_KIND, ownerEditHoldReason } from "./owner-edit-hold";
import { assertTenantContext, type TenantContext } from "./tenant";

function stripEmptyStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmptyStrings);
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.trim() === "") continue;
    next[key] = stripEmptyStrings(entry);
  }
  return next;
}

function asPayload(value: unknown): WizardPayload {
  return wizardPayloadSchema.parse(stripEmptyStrings(value));
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function wizardDrafts(ctx: TenantContext) {
  assertTenantContext(ctx);
  return {
    async getByClientId(clientId: string) {
      if (ctx.role !== "admin") return null;
      return prisma.wizardDraft.findFirst({
        where: { clientId, discardedAt: null, client: { archivedAt: null } },
      });
    },
  };
}

export async function startWizard(
  ctx: Actor,
  name: string,
  extras: {
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    industry?: string | null;
  } = {},
) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can start a wizard");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a business name.");
  const contactName = extras.contactName?.trim() || null;
  const contactPhone = extras.contactPhone?.trim() || null;
  const contactEmail = extras.contactEmail?.trim() || null;
  const industry = extras.industry?.trim() || null;
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: trimmed,
        status: "lead",
        timezone: "America/New_York",
        contactName,
        contactPhone,
        contactEmail,
        industry,
      },
    });
    const payload = {
      ...emptyWizardPayload(),
      business: {
        name: trimmed,
        timezone: "America/New_York",
        ...(contactName ? { contactName } : {}),
        ...(contactPhone ? { contactPhone } : {}),
        ...(contactEmail ? { contactEmail } : {}),
        ...(industry ? { industry } : {}),
      },
    };
    await tx.wizardDraft.create({
      data: {
        clientId: client.id,
        currentStep: 1,
        payload: json(payload),
        createdById: ctx.id,
      },
    });
    await tx.knowledgeBase.create({
      data: { clientId: client.id, version: 1, status: "draft" },
    });
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "client.created",
      entityType: "client",
      entityId: client.id,
      summary: `Started a lead for ${trimmed}`,
      after: { name: trimmed },
    });
    return client;
  });
}

export async function saveWizardDraft(
  ctx: Actor,
  input: { clientId: string; payload: unknown; currentStep: number; updatedAt: string },
) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can edit a wizard");
  const payload = asPayload(input.payload);
  const step = Math.min(11, Math.max(1, input.currentStep));
  return prisma.$transaction(async (tx) => {
    const draft = await tx.wizardDraft.findFirst({
      where: { clientId: input.clientId, discardedAt: null, client: { archivedAt: null, wizardSubmittedAt: null } },
    });
    if (!draft) throw new Error("Draft not found.");
    if (draft.updatedAt.toISOString() !== input.updatedAt) {
      throw new Error("This draft was saved in another tab. Reload it.");
    }
    return tx.wizardDraft.update({
      where: { id: draft.id },
      data: { payload: json(payload), currentStep: step },
    });
  });
}

/**
 * Writes one wizard step onto the client. In "draft" mode (the create flow) knowledge lands on the draft
 * knowledge base and transfer targets wait for submit. In "edit" mode (a submitted client) knowledge lands on
 * the latest knowledge base and transfer targets are replaced right away.
 */
async function applyStep(
  tx: Prisma.TransactionClient,
  clientId: string,
  step: number,
  payload: WizardPayload,
  mode: "draft" | "edit" = "draft",
) {
  if (step === 1) {
    const business = businessSchema.parse({ timezone: "America/New_York", ...payload.business });
    await tx.client.update({
      where: { id: clientId },
      data: {
        ...business,
        contactPhone: business.contactPhone ?? null,
        addressLine1: business.addressLine1 ?? null,
        addressLine2: business.addressLine2 ?? null,
        city: business.city ?? null,
        region: business.region ?? null,
        postalCode: business.postalCode ?? null,
        country: business.country ?? null,
        websiteUrl: business.websiteUrl ?? null,
        namePronunciation: business.namePronunciation ?? null,
        publicPhone: business.publicPhone ?? null,
        publicEmail: business.publicEmail ?? null,
      },
    });
  }
  if (step === 2) {
    await tx.client.update({
      where: { id: clientId },
      data: { websiteNotes: payload.websiteNotes?.slice(0, 5000) ?? null },
    });
  }
  if (step === 3) {
    const plan = planSelectionSchema.parse(payload.plan);
    const row = await tx.plan.findFirst({ where: { id: plan.planId, active: true }, select: { id: true } });
    if (!row) throw new Error("Choose a plan.");
    await tx.client.update({
      where: { id: clientId },
      data: {
        planId: plan.planId,
        overrideMonthlyPriceCents: plan.overrideMonthlyPriceCents ?? null,
        overrideIncludedMinutes: plan.overrideIncludedMinutes ?? null,
        overrideOveragePerMinuteCents: plan.overrideOveragePerMinuteCents ?? null,
        overrideSetupFeeCents: plan.overrideSetupFeeCents ?? null,
        overrideIncludedChangesPerMonth: plan.overrideIncludedChangesPerMonth ?? null,
        setupFeeWaived: plan.setupFeeWaived,
      },
    });
  }
  if (step === 4) {
    await tx.client.update({ where: { id: clientId }, data: { coverage: json(coverageSchema.parse(payload.coverage ?? {})) } });
  }
  if (step === 5) {
    const features = featuresSchema.parse(payload.features ?? {});
    const weeklyHours = parseWeeklyHours(features.weeklyHoursText ?? "");
    const targets = parseTransferTargets(features.transferTargetsText ?? "");
    if (features.messageRecipients) parseRecipientEmails(features.messageRecipients);
    await tx.client.update({
      where: { id: clientId },
      data: {
        features: json(features),
        weeklyHours: Object.keys(weeklyHours).length > 0 ? weeklyHours : Prisma.DbNull,
      },
    });
    if (mode === "edit") {
      await tx.transferTarget.deleteMany({ where: { clientId } });
      for (const target of targets) {
        await tx.transferTarget.create({ data: { clientId, label: target.label, e164: target.e164 } });
      }
    }
  }
  if (step === 6) {
    await tx.client.update({ where: { id: clientId }, data: { voice: json(voiceSchema.parse(payload.voice ?? {})) } });
  }
  if (step === 7) {
    const fields = knowledgeFieldsSchema.parse(payload.knowledge ?? {});
    const latest = mode === "edit" ? await tx.knowledgeBase.findFirst({ where: { clientId }, orderBy: { version: "desc" }, select: { id: true } }) : null;
    await tx.knowledgeBase.updateMany({
      where: latest ? { id: latest.id } : { clientId, status: "draft" },
      data: {
        hours: fields.hours ?? Prisma.DbNull,
        services: fields.services ?? Prisma.DbNull,
        faqs: fields.faqs ?? Prisma.DbNull,
        policies: fields.policies ?? Prisma.DbNull,
        staff: fields.staff ?? Prisma.DbNull,
      },
    });
  }
  if (step === 8) {
    await tx.client.update({ where: { id: clientId }, data: { phone: json(phoneSchema.parse(payload.phone ?? {})) } });
  }
  if (step === 9) {
    const { callRetentionDays, ...compliance } = complianceSchema.parse({ aiDisclosure: true, ...payload.compliance });
    await tx.client.update({ where: { id: clientId }, data: { compliance: json(compliance), callRetentionDays } });
  }
  if (step === 10) {
    const email = zEmail(payload.portalOwnerEmail);
    await tx.client.update({ where: { id: clientId }, data: { portalOwnerEmail: email } });
  }
}

function zEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the client owner's email.");
  return email;
}

export async function continueWizard(ctx: Actor, input: { clientId: string; step: number; payload: unknown; updatedAt: string }) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can edit a wizard");
  const payload = asPayload(input.payload);
  const step = Math.min(11, Math.max(1, input.step));
  return prisma.$transaction(async (tx) => {
    const draft = await tx.wizardDraft.findFirst({
      where: { clientId: input.clientId, discardedAt: null, client: { archivedAt: null, wizardSubmittedAt: null } },
    });
    if (!draft || draft.updatedAt.toISOString() !== input.updatedAt) {
      throw new Error("This draft was saved in another tab. Reload it.");
    }
    await applyStep(tx, input.clientId, step, payload);
    const saved = await tx.wizardDraft.update({
      where: { id: draft.id },
      data: { payload: json(payload), currentStep: Math.min(11, step + 1) },
    });
    await recordChange(tx, {
      clientId: input.clientId,
      actor: ctx,
      action: "wizard.step_saved",
      entityType: "wizard_draft",
      entityId: saved.id,
      summary: `Saved wizard step ${step}`,
    });
    return saved;
  });
}

export async function submitWizard(ctx: Actor, input: { clientId: string; payload: unknown; updatedAt: string }) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can submit a wizard");
  const payload = asPayload(input.payload);
  businessSchema.parse({ timezone: "America/New_York", ...payload.business });
  planSelectionSchema.parse(payload.plan);
  const email = zEmail(payload.portalOwnerEmail);
  const compliance = complianceSchema.parse({ aiDisclosure: true, ...payload.compliance });
  if (healthcareRequired(payload)) {
    if (!compliance.complianceReviewDone || compliance.complianceReviewNote.trim().length === 0) {
      throw new Error("Healthcare clients need a completed compliance review note before submit.");
    }
  }
  return prisma.$transaction(async (tx) => {
    const draft = await tx.wizardDraft.findFirst({
      where: { clientId: input.clientId, discardedAt: null, client: { archivedAt: null, wizardSubmittedAt: null } },
    });
    if (!draft || draft.updatedAt.toISOString() !== input.updatedAt) {
      throw new Error("This draft was saved in another tab. Reload it.");
    }
    for (let step = 1; step <= 10; step += 1) {
      await applyStep(tx, input.clientId, step, payload);
    }
    const targets = parseTransferTargets(payload.features?.transferTargetsText ?? "");
    await tx.transferTarget.deleteMany({ where: { clientId: input.clientId } });
    if (targets.length > 0) {
      await tx.transferTarget.createMany({
        data: targets.map((target) => ({ clientId: input.clientId, label: target.label, e164: target.e164 })),
      });
    }
    await tx.knowledgeBase.updateMany({ where: { clientId: input.clientId, status: "draft" }, data: { status: "submitted" } });
    const client = await tx.client.update({
      where: { id: input.clientId },
      data: { wizardSubmittedAt: new Date(), status: "lead", portalOwnerEmail: email },
    });
    await tx.wizardDraft.update({
      where: { id: draft.id },
      data: { payload: json(payload), currentStep: 11 },
    });
    await createDraftAgentConfig(ctx, tx, client.id);
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "wizard.submitted",
      entityType: "client",
      entityId: client.id,
      summary: `Submitted the wizard for ${client.name}`,
    });
    return client;
  });
}

export async function discardWizard(ctx: Actor, clientId: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can discard a draft");
  const documents = await prisma.knowledgeDocument.findMany({
    where: { clientId },
    select: { storageKey: true },
  });
  await prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: clientId, archivedAt: null, wizardSubmittedAt: null },
    });
    if (!client) throw new Error("Only an unsubmitted lead can be discarded.");
    await tx.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } });
    await tx.wizardDraft.updateMany({ where: { clientId }, data: { discardedAt: new Date() } });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "wizard.discarded",
      entityType: "client",
      entityId: clientId,
      summary: `Discarded the draft for ${client.name}`,
    });
  });
  return documents.map((document) => document.storageKey);
}

export async function removeClient(ctx: Actor, clientId: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can remove a client");
  const documents = await prisma.knowledgeDocument.findMany({
    where: { clientId, extractionStatus: { not: "deleted" } },
    select: { id: true, storageKey: true },
  });
  await prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
    if (!client) throw new Error("That client is not available.");
    if (!clientCanBeRemoved(client.status)) {
      throw new Error("Only a lead or demo client can be removed.");
    }
    const removedAt = new Date();
    await tx.client.update({ where: { id: clientId }, data: { archivedAt: removedAt } });
    await tx.wizardDraft.updateMany({
      where: { clientId, discardedAt: null },
      data: { discardedAt: removedAt },
    });
    await tx.invite.updateMany({
      where: { clientId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: removedAt },
    });
    const people = await tx.user.findMany({ where: { clientId }, select: { id: true } });
    if (people.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: people.map((person) => person.id) } } });
    }
    for (const document of documents) {
      await tx.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          storageKey: `deleted/${document.id}`,
          extractionStatus: "deleted",
          extractedText: null,
          extractionError: null,
        },
      });
    }
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "client.removed",
      entityType: "client",
      entityId: clientId,
      summary: `Removed ${client.name}`,
    });
  });
  return documents.map((document) => document.storageKey).filter((key) => key.startsWith("clients/"));
}

export function changeLogs(ctx: TenantContext) {
  assertTenantContext(ctx);
  return {
    list(clientId?: string) {
      if (ctx.role !== "admin") {
        return prisma.changeLog.findMany({
          where: { clientId: ctx.clientId },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
      }
      return prisma.changeLog.findMany({
        where: clientId || ctx.clientId ? { clientId: clientId ?? ctx.clientId } : {},
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Builds the wizard payload from what is saved on the client right now. Edit mode reads this and never the
 * WizardDraft, which stops being the source of truth the moment the wizard is submitted.
 */
function assertCanEditClient(ctx: Actor, clientId: string): void {
  assertTenantContext(ctx);
  if (ctx.role === "admin") return;
  if (ctx.role === "client_owner" && ctx.clientId === clientId) return;
  throw new Error("Only the client owner or an admin can edit this client.");
}

export async function clientEditPayload(ctx: Actor, clientId: string): Promise<WizardPayload> {
  assertCanEditClient(ctx, clientId);
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  if (!client.wizardSubmittedAt) throw new Error("Finish the wizard before editing this client.");
  const [knowledge, targets] = await Promise.all([
    prisma.knowledgeBase.findFirst({ where: { clientId }, orderBy: { version: "desc" } }),
    prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } }),
  ]);
  const features = record(client.features);
  const voice = record(client.voice);
  const phone = record(client.phone);
  const compliance = record(client.compliance);
  const coverage = record(client.coverage);
  const payload: WizardPayload = {
    version: 1,
    business: {
      name: client.name,
      industry: (INDUSTRIES as readonly string[]).includes(client.industry ?? "") ? (client.industry as (typeof INDUSTRIES)[number]) : undefined,
      contactName: client.contactName ?? undefined,
      contactEmail: client.contactEmail ?? undefined,
      contactPhone: client.contactPhone ?? undefined,
      addressLine1: client.addressLine1 ?? undefined,
      addressLine2: client.addressLine2 ?? undefined,
      city: client.city ?? undefined,
      region: client.region ?? undefined,
      postalCode: client.postalCode ?? undefined,
      country: client.country ?? undefined,
      timezone: client.timezone,
      websiteUrl: client.websiteUrl ?? undefined,
      namePronunciation: client.namePronunciation ?? undefined,
      publicPhone: client.publicPhone ?? undefined,
      publicEmail: client.publicEmail ?? undefined,
    },
    websiteNotes: client.websiteNotes ?? undefined,
    plan: {
      planId: client.planId ?? undefined,
      overrideMonthlyPriceCents: client.overrideMonthlyPriceCents,
      overrideIncludedMinutes: client.overrideIncludedMinutes,
      overrideOveragePerMinuteCents: client.overrideOveragePerMinuteCents,
      overrideSetupFeeCents: client.overrideSetupFeeCents,
      overrideIncludedChangesPerMonth: client.overrideIncludedChangesPerMonth,
      setupFeeWaived: client.setupFeeWaived,
    },
    coverage: {
      ...coverage,
      unansweredAfterRings: typeof coverage.unansweredAfterRings === "number" ? coverage.unansweredAfterRings : undefined,
    } as WizardPayload["coverage"],
    features: {
      ...features,
      weeklyHoursText: formatWeeklyHours(client.weeklyHours as WeeklyHours | null),
      transferTargetsText: formatTransferTargets(targets),
    } as WizardPayload["features"],
    voice: voice as WizardPayload["voice"],
    knowledge: {
      hours: text(knowledge?.hours),
      services: text(knowledge?.services),
      faqs: text(knowledge?.faqs),
      policies: text(knowledge?.policies),
      staff: text(knowledge?.staff),
    },
    phone: phone as WizardPayload["phone"],
    compliance: {
      aiDisclosure: true,
      recordingNotice: bool(compliance.recordingNotice) ?? true,
      healthcareSensitive: bool(compliance.healthcareSensitive) ?? false,
      healthcareTouched: bool(compliance.healthcareTouched) ?? false,
      complianceReviewDone: bool(compliance.complianceReviewDone) ?? false,
      complianceReviewNote: text(compliance.complianceReviewNote) ?? "",
      recallConsent: bool(compliance.recallConsent) ?? false,
      callRetentionDays: client.callRetentionDays,
    },
    portalOwnerEmail: client.portalOwnerEmail ?? undefined,
  };
  return asPayload(payload);
}

export type ClientEditResult = {
  step: number;
  title: string;
  changed: FieldChange[];
  /** New receptionist config version, when the step touches the agent. */
  configVersion: number | null;
  /** True when the client is provisioned and a `sync-<clientId>` job should run. */
  sync: boolean;
  /** True when the plan changed for a client with a Stripe subscription that was left untouched. */
  stripeWarning: boolean;
  /** Owner-only: the edit was held for admin review instead of publishing. */
  held?: boolean;
  holdReason?: string | null;
};

/**
 * Saves one wizard step onto a submitted client. Admin edits always publish. Owner edits publish unless
 * the hold rules fire (voice / transfer / booking change, or sensitive text), in which case a held
 * `owner_step` QuickUpdate is created for the admin queue. Nothing here talks to Stripe or Retell.
 */
export async function editClientStep(
  ctx: Actor,
  input: { clientId: string; step: number; payload: unknown },
): Promise<ClientEditResult> {
  assertCanEditClient(ctx, input.clientId);
  const step = Math.trunc(input.step);
  if (step < 1 || step > 10) throw new Error("Choose a step to edit.");
  if (ctx.role === "client_owner" && OWNER_BLOCKED_STEPS.has(step)) {
    throw new Error(OWNER_BLOCKED_STEP_HINT);
  }
  const payload = asPayload(input.payload);
  const before = await clientEditPayload(ctx, input.clientId);
  const section = SECTION_BY_STEP[step] ?? "business";
  const title = wizardStepTitle(step);
  const editKind = ctx.role === "client_owner" ? "owner_edit" : "admin_edit";
  const changed = diffSection(section, before[section], payload[section]);
  const holdReason = ctx.role === "client_owner" ? ownerEditHoldReason(before, payload, step) : null;

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: input.clientId, archivedAt: null } });
    if (!client?.wizardSubmittedAt) throw new Error("Finish the wizard before editing this client.");

    if (holdReason) {
      const held = await tx.quickUpdate.create({
        data: {
          clientId: input.clientId,
          kind: OWNER_STEP_HOLD_KIND,
          payload: { kind: OWNER_STEP_HOLD_KIND, step, title, payload } as unknown as Prisma.InputJsonValue,
          status: "held",
          holdReason,
          createdById: ctx.id,
        },
      });
      await recordChange(tx, {
        clientId: input.clientId,
        actor: ctx,
        action: "owner_edit.held",
        entityType: "quick_update",
        entityId: held.id,
        summary: `Held ${title} edit for ${client.name}`,
        after: { kind: OWNER_STEP_HOLD_KIND, step, title, fields: changeLogFields(changed), holdReason },
      });
      return { step, title, changed, configVersion: null, sync: false, stripeWarning: false, held: true, holdReason };
    }

    await applyStep(tx, input.clientId, step, payload, "edit");
    const stripeWarning = step === 3 && Boolean(client.stripeSubscriptionId);
    let configVersion: number | null = null;
    let sync = false;
    if (AGENT_AFFECTING_STEPS.has(step)) {
      const config = await rebuildAgentConfig(ctx, tx, input.clientId, editKind);
      configVersion = config.version;
      sync = Boolean(config.sync);
    }
    await recordChange(tx, {
      clientId: input.clientId,
      actor: ctx,
      action: editKind,
      entityType: "client",
      entityId: input.clientId,
      summary: `Edited ${title} for ${client.name}${changed.length === 0 ? " (no field changed)" : ""}`,
      after: {
        kind: editKind,
        step,
        title,
        fields: changeLogFields(changed),
        configVersion,
        stripeWarning,
      },
    });
    return { step, title, changed, configVersion, sync, stripeWarning, held: false, holdReason: null };
  });
}

/** Applies a held owner step edit during admin approval. Writes `owner_edit` with the approving admin as actor. */
export async function applyHeldOwnerStep(
  ctx: Actor,
  tx: Prisma.TransactionClient,
  input: { clientId: string; step: number; payload: unknown; title: string },
): Promise<{ configVersion: number | null; sync: boolean }> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can approve that.");
  const step = Math.trunc(input.step);
  const payload = asPayload(input.payload);
  const before = await clientEditPayload(ctx, input.clientId);
  const section = SECTION_BY_STEP[step] ?? "business";
  await applyStep(tx, input.clientId, step, payload, "edit");
  let configVersion: number | null = null;
  let sync = false;
  if (AGENT_AFFECTING_STEPS.has(step)) {
    const config = await rebuildAgentConfig(ctx, tx, input.clientId, "owner_edit");
    configVersion = config.version;
    sync = Boolean(config.sync);
  }
  const changed = diffSection(section, before[section], payload[section]);
  await recordChange(tx, {
    clientId: input.clientId,
    actor: ctx,
    action: "owner_edit",
    entityType: "client",
    entityId: input.clientId,
    summary: `Approved owner edit of ${input.title}`,
    after: { kind: "owner_edit", step, title: input.title, fields: changeLogFields(changed), configVersion, approved: true },
  });
  return { configVersion, sync };
}

