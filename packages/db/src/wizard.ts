import { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { createDraftAgentConfig } from "./agent";
import { recordChange, type Actor } from "./changes";
import {
  businessSchema,
  clientCanBeRemoved,
  complianceSchema,
  coverageSchema,
  emptyWizardPayload,
  featuresSchema,
  healthcareRequired,
  parseRecipientEmails,
  parseTransferTargets,
  parseWeeklyHours,
  knowledgeFieldsSchema,
  phoneSchema,
  planSelectionSchema,
  voiceSchema,
  wizardPayloadSchema,
  type WizardPayload,
} from "./domain";
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

export async function startWizard(ctx: Actor, name: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can start a wizard");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a business name.");
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { name: trimmed, status: "lead", timezone: "America/New_York" },
    });
    const payload = { ...emptyWizardPayload(), business: { name: trimmed, timezone: "America/New_York" } };
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

async function applyStep(tx: Prisma.TransactionClient, clientId: string, step: number, payload: WizardPayload) {
  if (step === 1) {
    const business = businessSchema.parse({ timezone: "America/New_York", ...payload.business });
    await tx.client.update({
      where: { id: clientId },
      data: { ...business, namePronunciation: business.namePronunciation ?? null },
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
    parseTransferTargets(features.transferTargetsText ?? "");
    if (features.messageRecipients) parseRecipientEmails(features.messageRecipients);
    await tx.client.update({
      where: { id: clientId },
      data: {
        features: json(features),
        weeklyHours: Object.keys(weeklyHours).length > 0 ? weeklyHours : Prisma.DbNull,
      },
    });
  }
  if (step === 6) {
    await tx.client.update({ where: { id: clientId }, data: { voice: json(voiceSchema.parse(payload.voice ?? {})) } });
  }
  if (step === 7) {
    const fields = knowledgeFieldsSchema.parse(payload.knowledge ?? {});
    await tx.knowledgeBase.updateMany({
      where: { clientId, status: "draft" },
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
    const compliance = complianceSchema.parse({ aiDisclosure: true, ...payload.compliance });
    await tx.client.update({ where: { id: clientId }, data: { compliance: json(compliance) } });
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
