import {
  CHANGE_CATEGORIES,
  allowanceState,
  buildGreeting,
  calendarMonthRange,
  diffFields,
  diffLines,
  faqItems,
  faqsToText,
  renderPrompt,
  sensitiveHoldReason,
  textsForHold,
  validateQuickUpdate,
  type AllowanceState,
  type ChangeCategory,
  type LineDiff,
  type FieldDiff,
  type PromptDocument,
  type PromptInput,
  type QuickUpdateInput,
  type RenderedPrompt,
  TEMPLATE_VERSION,
} from "@alinstra/agent";
import { isVoiceKey } from "@alinstra/providers";
import { Prisma } from "./generated/prisma/client";
import { prisma } from "./client";
import { recordChange, type Actor } from "./changes";
import { extractedTextOf, maskPhonesIn, openPayload, protectPayload, sealJson, staffOf } from "./cipher";
import { EXTRA_CHANGE_FEE_CENTS, wizardPayloadSchema } from "./domain";
import { OWNER_STEP_HOLD_KIND, parseOwnerStepHold } from "./owner-edit-hold";
import { flagAgentSync, writeTransferTargets } from "./provision";
import { assertTenantContext, type TenantContext } from "./tenant";

export type PromptPreview = {
  prompt: string;
  truncated: boolean;
  held: boolean;
  holdReason: string | null;
};

export type QuickUpdateResult = PromptPreview & {
  status: "applied" | "held";
  notify: { subject: string; text: string } | null;
  sync?: boolean;
};

export type AllowanceView = AllowanceState & { included: number | null; used: number };

function assertClient(ctx: TenantContext, clientId: string): void {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && ctx.clientId !== clientId) {
    throw new Error("That client is not available.");
  }
}

function assertAdmin(ctx: Actor): void {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can do that.");
}

function ownerId(ctx: Actor): string {
  assertTenantContext(ctx);
  if (ctx.role !== "client_owner" || !ctx.clientId) {
    throw new Error("Only the client owner can submit this.");
  }
  return ctx.clientId;
}

function jsonOr(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function plain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value : null;
}

function recordingOn(compliance: unknown): boolean {
  const value = asRecord(compliance).recordingNotice;
  return value !== false;
}

function personaOf(voice: unknown): { assistantName: string; disclosureMode: "on_request" | "upfront" } {
  const row = asRecord(voice);
  const name = typeof row.assistantName === "string" ? row.assistantName.trim() : "";
  return {
    assistantName: name || "Ava",
    disclosureMode: row.disclosureMode === "upfront" ? "upfront" : "on_request",
  };
}

function emergencyOf(features: unknown): string | null {
  const value = asRecord(features).emergencyHandling;
  return typeof value === "string" ? value : null;
}

type KnowledgeShape = {
  id: string;
  version: number;
  hours: unknown;
  services: unknown;
  faqs: unknown;
  policies: unknown;
  staff: unknown;
  notices: unknown;
};

type DocShape = { id: string; originalFilename: string; extractedText: string | null };

function toInput(
  client: {
    name: string;
    industry: string | null;
    namePronunciation: string | null;
    timezone?: string | null;
    voice: unknown;
    features: unknown;
    compliance: unknown;
    publicPhone?: string | null;
    publicEmail?: string | null;
  },
  knowledge: KnowledgeShape | null,
  documents: DocShape[],
): PromptInput {
  const docs: PromptDocument[] = documents.map((document) => ({
    id: document.id,
    filename: document.originalFilename,
    text: document.extractedText ?? "",
  }));
  const persona = personaOf(client.voice);
  const recordingNotice = recordingOn(client.compliance);
  return {
    businessName: client.name,
    namePronunciation: client.namePronunciation,
    industry: client.industry,
    assistantName: persona.assistantName,
    disclosureMode: persona.disclosureMode,
    timezone: client.timezone || "America/New_York",
    greeting: buildGreeting({
      businessName: client.name,
      assistantName: persona.assistantName,
      disclosureMode: persona.disclosureMode,
      recordingNotice,
      hoursState: "open",
      features: featuresOf(client.features),
    }),
    recordingNotice,
    hours: plain(knowledge?.hours) ?? faqsToText(knowledge?.hours),
    services: plain(knowledge?.services) ?? faqsToText(knowledge?.services),
    faqs: faqsToText(knowledge?.faqs),
    policies: plain(knowledge?.policies) ?? faqsToText(knowledge?.policies),
    staff: plain(knowledge?.staff) ?? faqsToText(knowledge?.staff),
    notices: plain(knowledge?.notices) ?? faqsToText(knowledge?.notices),
    emergency: emergencyOf(client.features),
    features: featuresOf(client.features),
    documents: docs,
    publicPhone: client.publicPhone ?? null,
    publicEmail: client.publicEmail ?? null,
  };
}

function featuresOf(features: unknown): PromptInput["features"] {
  const row = asRecord(features);
  const mode = row.bookingMode;
  return {
    bookingMode: mode === "request_only" || mode === "direct_calendar" ? mode : null,
    liveTransfer: row.liveTransfer === true,
    messages: typeof row.messages === "string" ? row.messages : null,
  };
}

function settingsOf(
  input: PromptInput,
  rendered: RenderedPrompt,
  snapshot?: { features?: unknown; coverage?: unknown },
): Prisma.InputJsonValue {
  return {
    templateId: rendered.templateId,
    templateVersion: rendered.templateVersion,
    recordingNotice: input.recordingNotice,
    namePronunciation: input.namePronunciation ?? "",
    industry: input.industry ?? "",
    greeting: input.greeting ?? "",
    hours: input.hours ?? "",
    services: input.services ?? "",
    faqs: input.faqs ?? "",
    policies: input.policies ?? "",
    staff: input.staff ?? "",
    notices: input.notices ?? "",
    emergency: input.emergency ?? "",
    assistantName: input.assistantName ?? "Ava",
    disclosureMode: input.disclosureMode ?? "on_request",
    timezone: input.timezone ?? "",
    publicPhone: input.publicPhone ?? "",
    publicEmail: input.publicEmail ?? "",
    referenceToken: rendered.referenceToken,
    features: (snapshot?.features ?? {}) as Prisma.InputJsonValue,
    coverage: (snapshot?.coverage ?? {}) as Prisma.InputJsonValue,
  };
}

async function load(tx: Prisma.TransactionClient, clientId: string) {
  const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const stored = await tx.knowledgeBase.findFirst({ where: { clientId }, orderBy: { version: "desc" } });
  // Staff notes are encrypted at rest; decrypt only here, where the prompt input is built.
  const knowledge = stored ? { ...stored, staff: staffOf(stored) } : null;
  const rows = await tx.knowledgeDocument.findMany({
    where: { clientId, extractionStatus: { not: "deleted" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalFilename: true, extractedText: true, extractedTextCipher: true },
  });
  const documents = rows.map((row) => ({ id: row.id, originalFilename: row.originalFilename, extractedText: extractedTextOf(row) }));
  return { client, knowledge, documents, input: toInput(client, knowledge, documents) };
}

async function nextVersion(tx: Prisma.TransactionClient, clientId: string): Promise<number> {
  const latest = await tx.agentConfig.aggregate({ where: { clientId }, _max: { version: true } });
  return (latest._max.version ?? 0) + 1;
}

async function insertConfig(
  tx: Prisma.TransactionClient,
  args: {
    clientId: string;
    status: "draft" | "active";
    source: string;
    createdById: string;
    actor: Actor;
    input: PromptInput;
    knowledge: KnowledgeShape | null;
    documentIds: string[];
    voice: unknown;
    features?: unknown;
    coverage?: unknown;
  },
) {
  if (args.status === "active") {
    await tx.agentConfig.updateMany({ where: { clientId: args.clientId, status: "active" }, data: { status: "superseded" } });
  }
  const rendered = renderPrompt(args.input);
  const created = await tx.agentConfig.create({
    data: {
      clientId: args.clientId,
      version: await nextVersion(tx, args.clientId),
      status: args.status,
      promptText: rendered.text,
      promptTruncated: rendered.truncated,
      templateId: rendered.templateId,
      templateVersion: rendered.templateVersion,
      knowledgeBaseId: args.knowledge?.id ?? null,
      knowledgeVersion: args.knowledge?.version ?? null,
      documentIds: args.documentIds,
      voice: jsonOr(args.voice),
      greeting: args.input.greeting ?? null,
      referenceToken: rendered.referenceToken,
      tools: rendered.tools,
      settings: settingsOf(args.input, rendered, { features: args.features, coverage: args.coverage }),
      platformAgentId: null,
      source: args.source,
      createdById: args.createdById,
    },
  });
  const sync = args.status === "active" ? await flagAgentSync(tx, args.clientId, args.actor) : false;
  return { ...created, sync };
}

export async function createDraftAgentConfig(ctx: Actor, tx: Prisma.TransactionClient, clientId: string) {
  assertTenantContext(ctx);
  if (ctx.role === "admin") {
    // ok
  } else if (ctx.role === "client_owner" && ctx.clientId === clientId) {
    // Self-serve owners create the draft config when they submit for review.
  } else {
    throw new Error("Only an admin or the client owner can create a draft config.");
  }
  const loaded = await load(tx, clientId);
  const config = await insertConfig(tx, {
    clientId,
    status: "draft",
    source: "wizard",
    createdById: ctx.id,
    actor: ctx,
    input: loaded.input,
    knowledge: loaded.knowledge,
    documentIds: loaded.documents.map((document) => document.id),
    voice: loaded.client.voice,
    features: loaded.client.features,
    coverage: loaded.client.coverage,
  });
  await recordChange(tx, {
    clientId,
    actor: ctx,
    action: "agent_config.created",
    entityType: "agent_config",
    entityId: config.id,
    summary: `Created draft receptionist config v${config.version} for ${loaded.client.name}`,
    after: { version: config.version, status: "draft", templateVersion: config.templateVersion },
  });
  return config;
}

/**
 * Rebuilds the receptionist config from the client's current data after an admin or owner edit. A client
 * with an active config gets a new active version (and a sync flag when it is provisioned); a client that
 * is still waiting on provisioning gets a fresh draft in place of the old one.
 */
export async function rebuildAgentConfig(ctx: Actor, tx: Prisma.TransactionClient, clientId: string, source: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && !(ctx.role === "client_owner" && ctx.clientId === clientId)) {
    throw new Error("Only the client owner or an admin can rebuild this config.");
  }
  const active = await tx.agentConfig.findFirst({ where: { clientId, status: "active" }, select: { id: true } });
  if (!active) {
    await tx.agentConfig.updateMany({ where: { clientId, status: "draft" }, data: { status: "superseded" } });
  }
  const loaded = await load(tx, clientId);
  const config = await insertConfig(tx, {
    clientId,
    status: active ? "active" : "draft",
    source,
    createdById: ctx.id,
    actor: ctx,
    input: loaded.input,
    knowledge: loaded.knowledge,
    documentIds: loaded.documents.map((document) => document.id),
    voice: loaded.client.voice,
    features: loaded.client.features,
    coverage: loaded.client.coverage,
  });
  const from = source === "owner_edit" ? "an owner edit" : "an admin edit";
  await recordChange(tx, {
    clientId,
    actor: ctx,
    action: active ? "agent_config.activated" : "agent_config.created",
    entityType: "agent_config",
    entityId: config.id,
    summary: `${active ? "Activated" : "Created draft"} receptionist config v${config.version} for ${loaded.client.name} from ${from}`,
    after: { version: config.version, status: config.status, templateVersion: config.templateVersion, source },
  });
  return config;
}

/**
 * Rebuilds the active config from current client data when the stored prompt was rendered by an older
 * template, or when the public contact details changed since it was rendered. Returns the new version or null.
 */
export async function refreshStaleAgentConfig(ctx: Actor, clientId: string): Promise<number | null> {
  const actor = ctx;
  return prisma.$transaction(async (tx) => {
    const active = await tx.agentConfig.findFirst({ where: { clientId, status: "active" } });
    if (!active) return null;
    const loaded = await load(tx, clientId);
    const settings = asRecord(active.settings);
    const stale =
      active.templateVersion !== TEMPLATE_VERSION ||
      String(settings.publicPhone ?? "") !== (loaded.client.publicPhone ?? "") ||
      String(settings.publicEmail ?? "") !== (loaded.client.publicEmail ?? "");
    if (!stale) return null;
    const config = await insertConfig(tx, {
      clientId,
      status: "active",
      source: "template_refresh",
      createdById: actor.id,
      actor,
      input: loaded.input,
      knowledge: loaded.knowledge,
      documentIds: loaded.documents.map((document) => document.id),
      voice: loaded.client.voice,
      features: loaded.client.features,
      coverage: loaded.client.coverage,
    });
    await recordChange(tx, {
      clientId,
      actor,
      action: "agent_config.refreshed",
      entityType: "agent_config",
      entityId: config.id,
      summary: `Rebuilt receptionist config v${config.version} for ${loaded.client.name} on template ${TEMPLATE_VERSION}`,
      after: { version: config.version, templateVersion: TEMPLATE_VERSION, fromTemplate: active.templateVersion },
    });
    return config.version;
  });
}

export function agentConfigs(ctx: TenantContext) {
  assertTenantContext(ctx);
  const clientFilter = ctx.role === "admin" ? {} : { clientId: ctx.clientId };
  return {
    list(clientId: string) {
      assertClient(ctx, clientId);
      return prisma.agentConfig.findMany({ where: { clientId }, orderBy: { version: "desc" } });
    },
    get(clientId: string, version: number) {
      assertClient(ctx, clientId);
      return prisma.agentConfig.findFirst({ where: { clientId, version } });
    },
    getById(id: string) {
      return prisma.agentConfig.findFirst({ where: { id, ...clientFilter } });
    },
  };
}

export function quickUpdates(ctx: TenantContext) {
  assertTenantContext(ctx);
  const clientFilter = ctx.role === "admin" ? {} : { clientId: ctx.clientId };
  return {
    list(clientId: string) {
      assertClient(ctx, clientId);
      return prisma.quickUpdate.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
    },
    getById(id: string) {
      return prisma.quickUpdate.findFirst({ where: { id, ...clientFilter } });
    },
    listHeld() {
      if (ctx.role !== "admin") throw new Error("Only an admin can do that.");
      return prisma.quickUpdate.findMany({ where: { status: "held" }, orderBy: { createdAt: "asc" } });
    },
  };
}

export function changeRequests(ctx: TenantContext) {
  assertTenantContext(ctx);
  const clientFilter = ctx.role === "admin" ? {} : { clientId: ctx.clientId };
  return {
    list(clientId: string) {
      assertClient(ctx, clientId);
      return prisma.changeRequest.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
    },
    getById(id: string) {
      return prisma.changeRequest.findFirst({ where: { id, ...clientFilter } });
    },
    listPending() {
      if (ctx.role !== "admin") throw new Error("Only an admin can do that.");
      return prisma.changeRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
    },
  };
}

function withPatch(input: PromptInput, knowledge: KnowledgeShape | null, patch: Record<string, unknown>): PromptInput {
  const next = knowledge
    ? { ...knowledge, ...patch }
    : { id: "", version: 0, hours: null, services: null, faqs: null, policies: null, staff: null, notices: null, ...patch };
  return {
    ...input,
    hours: plain(next.hours) ?? faqsToText(next.hours),
    services: plain(next.services) ?? faqsToText(next.services),
    faqs: faqsToText(next.faqs),
    policies: plain(next.policies) ?? faqsToText(next.policies),
    staff: plain(next.staff) ?? faqsToText(next.staff),
    notices: plain(next.notices) ?? faqsToText(next.notices),
  };
}

function appendNotice(current: unknown, text: string): string {
  const base = typeof current === "string" ? current.trim() : "";
  return base ? `${base}\n${text.trim()}` : text.trim();
}

/** Staff entries carry names, roles, and availability only. Transfer numbers live in TransferTarget and route by label. */
function staffText(input: { text: string; transferNumber?: string }): string {
  return input.text.trim();
}

function patchFor(knowledge: KnowledgeShape | null, input: QuickUpdateInput): Record<string, unknown> {
  if (input.kind === "transfers") return {};
  if (input.kind === "hours") return { hours: input.text };
  if (input.kind === "closure") return { notices: appendNotice(knowledge?.notices, input.text) };
  if (input.kind === "staff") return { staff: staffText(input) };
  const items = faqItems(knowledge?.faqs);
  if (input.kind === "faq_add") {
    items.push({ question: input.question.trim(), answer: input.answer.trim() });
    return { faqs: items };
  }
  if (!items[input.index]) throw new Error("Choose a FAQ.");
  if (input.kind === "faq_edit") {
    items[input.index] = { question: input.question.trim(), answer: input.answer.trim() };
    return { faqs: items };
  }
  items.splice(input.index, 1);
  return { faqs: items };
}

function parseQuick(payload: unknown): QuickUpdateInput {
  const row = asRecord(payload);
  const kind = row.kind;
  if (kind === "hours" || kind === "closure" || kind === "transfers") return { kind, text: String(row.text ?? "") };
  if (kind === "staff") {
    return {
      kind,
      text: String(row.text ?? ""),
      transferNumber: typeof row.transferNumber === "string" ? row.transferNumber : undefined,
    };
  }
  if (kind === "faq_add" || kind === "faq_edit") {
    return {
      kind,
      index: Number(row.index ?? 0),
      question: String(row.question ?? ""),
      answer: String(row.answer ?? ""),
    };
  }
  if (kind === "faq_remove") return { kind, index: Number(row.index ?? -1) };
  throw new Error("That update cannot be applied.");
}

async function forkKnowledge(tx: Prisma.TransactionClient, clientId: string, patch: Record<string, unknown>) {
  const current = await tx.knowledgeBase.findFirst({ where: { clientId }, orderBy: { version: "desc" } });
  if (!current) throw new Error("Submit the wizard before changing the receptionist.");
  const latest = await tx.knowledgeBase.aggregate({ where: { clientId }, _max: { version: true } });
  return tx.knowledgeBase.create({
    data: {
      clientId,
      version: (latest._max.version ?? 0) + 1,
      status: "submitted",
      hours: jsonOr(patch.hours !== undefined ? patch.hours : current.hours),
      services: jsonOr(patch.services !== undefined ? patch.services : current.services),
      faqs: jsonOr(patch.faqs !== undefined ? patch.faqs : current.faqs),
      policies: jsonOr(patch.policies !== undefined ? patch.policies : current.policies),
      staff: Prisma.DbNull,
      staffCipher: sealJson(patch.staff !== undefined ? patch.staff : staffOf(current)),
      notices: jsonOr(patch.notices !== undefined ? patch.notices : current.notices),
    },
  });
}

export async function previewWizardPrompt(ctx: Actor, input: { clientId: string; payload: unknown }): Promise<PromptPreview> {
  assertAdmin(ctx);
  const payload = wizardPayloadSchema.parse(input.payload);
  return prisma.$transaction(async (tx) => {
    const loaded = await load(tx, input.clientId);
    const business = payload.business ?? {};
    const knowledge = payload.knowledge ?? {};
    const voice = payload.voice ?? asRecord(loaded.client.voice);
    const compliance = { ...asRecord(loaded.client.compliance), ...asRecord(payload.compliance) };
    const features = { ...asRecord(loaded.client.features), ...asRecord(payload.features) };
    const persona = personaOf(voice);
    const recordingNotice = recordingOn(compliance);
    const businessName = business.name || loaded.client.name;
    const promptInput: PromptInput = {
      ...loaded.input,
      businessName,
      industry: business.industry ?? loaded.client.industry,
      namePronunciation: business.namePronunciation ?? loaded.client.namePronunciation,
      assistantName: persona.assistantName,
      disclosureMode: persona.disclosureMode,
      timezone: loaded.client.timezone || "America/New_York",
      greeting: buildGreeting({
        businessName,
        assistantName: persona.assistantName,
        disclosureMode: persona.disclosureMode,
        recordingNotice,
        hoursState: "open",
        features: featuresOf(features),
      }),
      recordingNotice,
      emergency: emergencyOf(features),
      hours: knowledge.hours ?? loaded.input.hours,
      services: knowledge.services ?? loaded.input.services,
      faqs: knowledge.faqs ?? loaded.input.faqs,
      policies: knowledge.policies ?? loaded.input.policies,
      staff: knowledge.staff ?? loaded.input.staff,
      publicPhone: business.publicPhone ?? loaded.client.publicPhone,
      publicEmail: business.publicEmail ?? loaded.client.publicEmail,
    };
    const rendered = renderPrompt(promptInput);
    return { prompt: rendered.text, truncated: rendered.truncated, held: false, holdReason: null };
  });
}

export async function previewQuickUpdate(ctx: Actor, input: QuickUpdateInput): Promise<PromptPreview> {
  const clientId = ownerId(ctx);
  const error = validateQuickUpdate(input);
  if (error) throw new Error(error);
  return prisma.$transaction(async (tx) => {
    const loaded = await load(tx, clientId);
    if (!loaded.client.wizardSubmittedAt) throw new Error("Submit the wizard before changing the receptionist.");
    const patch = patchFor(loaded.knowledge, input);
    const rendered = renderPrompt(withPatch(loaded.input, loaded.knowledge, patch));
    const holdReason = sensitiveHoldReason(textsForHold(input));
    return { prompt: rendered.text, truncated: rendered.truncated, held: holdReason !== null, holdReason };
  });
}

export async function applyQuickUpdate(ctx: Actor, input: QuickUpdateInput): Promise<QuickUpdateResult> {
  const clientId = ownerId(ctx);
  const error = validateQuickUpdate(input);
  if (error) throw new Error(error);
  return prisma.$transaction(async (tx) => {
    if (input.kind === "transfers") {
      const loaded = await load(tx, clientId);
      if (!loaded.client.wizardSubmittedAt) throw new Error("Submit the wizard before changing the receptionist.");
      const holdReason = sensitiveHoldReason(textsForHold(input));
      if (holdReason) {
        const held = await tx.quickUpdate.create({
          data: { clientId, kind: input.kind, payload: protectPayload(input) as unknown as Prisma.InputJsonValue, status: "held", holdReason, createdById: ctx.id },
        });
        await recordChange(tx, {
          clientId,
          actor: ctx,
          action: "quick_update.held",
          entityType: "quick_update",
          entityId: held.id,
          summary: `Held a transfers update for ${loaded.client.name}`,
          after: { holdReason },
        });
        return { status: "held" as const, prompt: "Transfer targets are waiting for review.", truncated: false, held: true, holdReason, notify: null };
      }
      const sync = await writeTransferTargets(tx, ctx, clientId, input.text);
      const row = await tx.quickUpdate.create({
        data: { clientId, kind: input.kind, payload: maskPhonesIn(input) as unknown as Prisma.InputJsonValue, status: "applied", createdById: ctx.id },
      });
      await recordChange(tx, {
        clientId,
        actor: ctx,
        action: "quick_update.applied",
        entityType: "quick_update",
        entityId: row.id,
        summary: `Applied transfer targets for ${loaded.client.name}`,
      });
      return { status: "applied" as const, prompt: "Transfer targets are saved.", truncated: false, held: false, holdReason: null, notify: null, sync };
    }
    const loaded = await load(tx, clientId);
    if (!loaded.client.wizardSubmittedAt) throw new Error("Submit the wizard before changing the receptionist.");
    const patch = patchFor(loaded.knowledge, input);
    const holdReason = sensitiveHoldReason(textsForHold(input));
    if (holdReason) {
      const held = await tx.quickUpdate.create({
        data: {
          clientId,
          kind: input.kind,
          payload: protectPayload(input) as unknown as Prisma.InputJsonValue,
          status: "held",
          holdReason,
          createdById: ctx.id,
        },
      });
      await recordChange(tx, {
        clientId,
        actor: ctx,
        action: "quick_update.held",
        entityType: "quick_update",
        entityId: held.id,
        summary: `Held a ${input.kind} update for ${loaded.client.name}`,
        after: { holdReason },
      });
      const rendered = renderPrompt(withPatch(loaded.input, loaded.knowledge, patch));
      return { status: "held" as const, prompt: rendered.text, truncated: rendered.truncated, held: true, holdReason, notify: null };
    }
    const knowledge = await forkKnowledge(tx, clientId, patch);
    const fresh = await load(tx, clientId);
    const config = await insertConfig(tx, {
      clientId,
      status: "active",
      source: "quick_update",
      createdById: ctx.id,
      actor: ctx,
      input: fresh.input,
      knowledge,
      documentIds: fresh.documents.map((document) => document.id),
      voice: fresh.client.voice,
      features: fresh.client.features,
      coverage: fresh.client.coverage,
    });
    const row = await tx.quickUpdate.create({
      data: {
        clientId,
        kind: input.kind,
        payload: maskPhonesIn(input) as unknown as Prisma.InputJsonValue,
        status: "applied",
        agentConfigId: config.id,
        createdById: ctx.id,
      },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "quick_update.applied",
      entityType: "quick_update",
      entityId: row.id,
      summary: `Applied a ${input.kind} update for ${loaded.client.name}`,
      after: { agentConfigId: config.id, version: config.version },
    });
    return {
      status: "applied" as const,
      prompt: config.promptText,
      truncated: config.promptTruncated,
      held: false,
      holdReason: null,
      notify: {
        subject: `Quick update applied for ${loaded.client.name}`,
        text: `A ${input.kind} update is now version ${config.version} for ${loaded.client.name}.`,
      },
      sync: config.sync,
    };
  });
}

export async function previewHeldUpdate(ctx: Actor, id: string): Promise<PromptPreview> {
  assertAdmin(ctx);
  const row = await prisma.quickUpdate.findFirst({ where: { id, status: "held" } });
  if (!row) throw new Error("That update is not waiting for review.");
  if (row.kind === OWNER_STEP_HOLD_KIND) {
    const held = parseOwnerStepHold(openPayload(row.payload));
    return {
      prompt: held ? `Owner edit of ${held.title} (step ${held.step}) is waiting for review.` : "Owner edit is waiting for review.",
      truncated: false,
      held: true,
      holdReason: row.holdReason,
    };
  }
  const input = parseQuick(openPayload(row.payload));
  return prisma.$transaction(async (tx) => {
    const loaded = await load(tx, row.clientId);
    const patch = patchFor(loaded.knowledge, input);
    const rendered = renderPrompt(withPatch(loaded.input, loaded.knowledge, patch));
    return { prompt: rendered.text, truncated: rendered.truncated, held: true, holdReason: row.holdReason };
  });
}

export async function approveQuickUpdate(ctx: Actor, id: string): Promise<{ prompt: string; truncated: boolean; clientId: string }> {
  assertAdmin(ctx);
  return prisma.$transaction(async (tx) => {
    const row = await tx.quickUpdate.findFirst({ where: { id, status: "held" } });
    if (!row) throw new Error("That update is not waiting for review.");
    if (row.kind === OWNER_STEP_HOLD_KIND) {
      const held = parseOwnerStepHold(openPayload(row.payload));
      if (!held) throw new Error("That update cannot be applied.");
      // Lazy import avoids a wizard ↔ agent cycle (wizard already calls rebuildAgentConfig).
      const { applyHeldOwnerStep } = await import("./wizard");
      const applied = await applyHeldOwnerStep(ctx, tx, { clientId: row.clientId, step: held.step, payload: held.payload, title: held.title });
      await tx.quickUpdate.update({
        where: { id: row.id },
        data: { status: "approved", reviewedById: ctx.id, reviewedAt: new Date() },
      });
      await recordChange(tx, {
        clientId: row.clientId,
        actor: ctx,
        action: "quick_update.approved",
        entityType: "quick_update",
        entityId: row.id,
        summary: `Approved a held owner edit of ${held.title}`,
        after: { step: held.step, configVersion: applied.configVersion },
      });
      return { prompt: `Owner edit of ${held.title} is live.`, truncated: false, clientId: row.clientId };
    }
    const input = parseQuick(openPayload(row.payload));
    const error = validateQuickUpdate(input);
    if (error) throw new Error(error);
    if (input.kind === "transfers") {
      await writeTransferTargets(tx, ctx, row.clientId, input.text);
      await tx.quickUpdate.update({
        where: { id: row.id },
        data: { status: "approved", reviewedById: ctx.id, reviewedAt: new Date() },
      });
      await recordChange(tx, {
        clientId: row.clientId,
        actor: ctx,
        action: "quick_update.approved",
        entityType: "quick_update",
        entityId: row.id,
        summary: "Approved a held transfers update",
      });
      return { prompt: "Transfer targets are saved.", truncated: false, clientId: row.clientId };
    }
    const patch = patchFor((await load(tx, row.clientId)).knowledge, input);
    const knowledge = await forkKnowledge(tx, row.clientId, patch);
    const fresh = await load(tx, row.clientId);
    const config = await insertConfig(tx, {
      clientId: row.clientId,
      status: "active",
      source: "quick_update",
      createdById: ctx.id,
      actor: ctx,
      input: fresh.input,
      knowledge,
      documentIds: fresh.documents.map((document) => document.id),
      voice: fresh.client.voice,
      features: fresh.client.features,
      coverage: fresh.client.coverage,
    });
    await tx.quickUpdate.update({
      where: { id: row.id },
      data: { status: "approved", agentConfigId: config.id, reviewedById: ctx.id, reviewedAt: new Date() },
    });
    await recordChange(tx, {
      clientId: row.clientId,
      actor: ctx,
      action: "quick_update.approved",
      entityType: "quick_update",
      entityId: row.id,
      summary: `Approved a held ${row.kind} update`,
      after: { agentConfigId: config.id, version: config.version },
    });
    return { prompt: config.promptText, truncated: config.promptTruncated, clientId: row.clientId };
  });
}

export async function rejectQuickUpdate(ctx: Actor, id: string, reason = ""): Promise<void> {
  assertAdmin(ctx);
  const note = reason.trim().slice(0, 500) || "Rejected by admin.";
  await prisma.$transaction(async (tx) => {
    const row = await tx.quickUpdate.findFirst({ where: { id, status: "held" } });
    if (!row) throw new Error("That update is not waiting for review.");
    await tx.quickUpdate.update({
      where: { id: row.id },
      // holdReason carries the rejection note so the owner can read it on My Business.
      data: { status: "rejected", holdReason: note, reviewedById: ctx.id, reviewedAt: new Date() },
    });
    await recordChange(tx, {
      clientId: row.clientId,
      actor: ctx,
      action: "quick_update.rejected",
      entityType: "quick_update",
      entityId: row.id,
      summary: `Rejected a held ${row.kind} update`,
      after: { reason: note },
    });
  });
}

function cleanCategory(value: string): ChangeCategory {
  if (!(CHANGE_CATEGORIES as readonly string[]).includes(value)) throw new Error("Choose a category.");
  return value as ChangeCategory;
}

function cleanDescription(value: string): string {
  const text = value.trim();
  if (text.length === 0) throw new Error("Describe the change.");
  if (text.length > 4_000) throw new Error("Descriptions must be 4,000 characters or fewer.");
  return text;
}

async function readAllowance(tx: Prisma.TransactionClient, clientId: string, now: Date): Promise<AllowanceView> {
  const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null }, include: { plan: true } });
  if (!client) throw new Error("That client is not available.");
  const included =
    client.overrideIncludedChangesPerMonth !== null
      ? client.overrideIncludedChangesPerMonth
      : client.plan
        ? client.plan.includedChangesPerMonth
        : 0;
  const range = calendarMonthRange(client.timezone || "America/New_York", now);
  const used = await tx.changeRequest.count({
    where: {
      clientId,
      status: { in: ["pending", "approved"] },
      createdAt: { gte: range.start, lt: range.end },
    },
  });
  const state = allowanceState({
    included,
    used,
    extraChangeFeeCents: client.plan?.extraChangeFeeCents ?? EXTRA_CHANGE_FEE_CENTS,
  });
  return { ...state, included, used };
}

export async function changeAllowance(ctx: Actor, clientId: string, now = new Date()): Promise<AllowanceView> {
  assertClient(ctx, clientId);
  if (ctx.role === "client_staff") throw new Error("Only the client owner can submit this.");
  return prisma.$transaction((tx) => readAllowance(tx, clientId, now));
}

export async function submitChangeRequest(
  ctx: Actor,
  input: { category: string; description: string; confirmFee: boolean },
  now = new Date(),
) {
  const clientId = ownerId(ctx);
  const category = cleanCategory(input.category);
  const description = cleanDescription(input.description);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
    if (!client?.wizardSubmittedAt) throw new Error("Submit the wizard before changing the receptionist.");
    const allowance = await readAllowance(tx, clientId, now);
    if (allowance.over && !input.confirmFee) throw new Error("Confirm the extra change fee.");
    const row = await tx.changeRequest.create({
      data: {
        clientId,
        category,
        description,
        status: "pending",
        feeCents: allowance.over ? allowance.feeCents : null,
        createdById: ctx.id,
        createdAt: now,
      },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "change_request.submitted",
      entityType: "change_request",
      entityId: row.id,
      summary: `Submitted a ${category} change request for ${client.name}`,
      after: { feeCents: row.feeCents },
    });
    return row;
  });
}

export async function cancelChangeRequest(ctx: Actor, id: string): Promise<void> {
  const clientId = ownerId(ctx);
  await prisma.$transaction(async (tx) => {
    const row = await tx.changeRequest.findFirst({ where: { id, clientId, status: "pending" } });
    if (!row) throw new Error("That request is not open.");
    await tx.changeRequest.update({
      where: { id: row.id },
      data: { status: "cancelled", reviewedAt: new Date() },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "change_request.cancelled",
      entityType: "change_request",
      entityId: row.id,
      summary: "Cancelled a change request",
    });
  });
}

export type ReceptionistFields = {
  hours: string;
  services: string;
  faqs: string;
  policies: string;
  staff: string;
  notices: string;
  greeting: string;
  assistantName: string;
  disclosureMode: string;
  voiceId: string;
  tone: string;
  languages: string;
  unansweredAfterRings: string;
  lunchHours: string;
  afterHours: string;
  weekends: string;
  holidays: string;
  holdOverflow: string;
  messages: string;
  bookingMode: string;
  textConfirmations: boolean;
  textReminders: boolean;
  liveTransfer: boolean;
  emergencyHandling: string;
  recallAddOn: boolean;
};

export type ChangeRequestPreview = {
  prompt: string;
  truncated: boolean;
  lines: LineDiff[];
  fields: FieldDiff[];
};

function fieldText(value: unknown): string {
  if (typeof value === "string") return value;
  return faqsToText(value) ?? "";
}

function flagText(value: unknown): boolean {
  return value === true;
}

function fieldsOf(loaded: { client: { name: string; voice: unknown; coverage: unknown; features: unknown }; knowledge: KnowledgeShape | null }): ReceptionistFields {
  const voice = asRecord(loaded.client.voice);
  const coverage = asRecord(loaded.client.coverage);
  const features = asRecord(loaded.client.features);
  const voiceId = isVoiceKey(voice.voiceId) ? voice.voiceId : "";
  const bookingMode = features.bookingMode === "request_only" || features.bookingMode === "direct_calendar" ? features.bookingMode : "";
  return {
    hours: fieldText(loaded.knowledge?.hours),
    services: fieldText(loaded.knowledge?.services),
    faqs: fieldText(loaded.knowledge?.faqs),
    policies: fieldText(loaded.knowledge?.policies),
    staff: fieldText(loaded.knowledge?.staff),
    notices: fieldText(loaded.knowledge?.notices),
    greeting: typeof voice.greeting === "string" ? voice.greeting : "",
    assistantName: typeof voice.assistantName === "string" && voice.assistantName.trim() ? voice.assistantName : "Ava",
    disclosureMode: voice.disclosureMode === "upfront" ? "upfront" : "on_request",
    voiceId,
    tone: typeof voice.tone === "string" ? voice.tone : "",
    languages: typeof voice.languages === "string" ? voice.languages : "",
    unansweredAfterRings: typeof coverage.unansweredAfterRings === "number" ? String(coverage.unansweredAfterRings) : "",
    lunchHours: typeof coverage.lunchHours === "string" ? coverage.lunchHours : "",
    afterHours: typeof coverage.afterHours === "string" ? coverage.afterHours : "",
    weekends: typeof coverage.weekends === "string" ? coverage.weekends : "",
    holidays: typeof coverage.holidays === "string" ? coverage.holidays : "",
    holdOverflow: typeof coverage.holdOverflow === "string" ? coverage.holdOverflow : "",
    messages: typeof features.messages === "string" ? features.messages : "",
    bookingMode,
    textConfirmations: flagText(features.textConfirmations),
    textReminders: flagText(features.textReminders),
    liveTransfer: flagText(features.liveTransfer),
    emergencyHandling: typeof features.emergencyHandling === "string" ? features.emergencyHandling : "",
    recallAddOn: flagText(features.recallAddOn),
  };
}

function readText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Enter the receptionist fields.");
  if (value.length > 10_000) throw new Error("A field is too long.");
  return value;
}

function readFlag(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") throw new Error("Enter the receptionist fields.");
  return value;
}

function parseReceptionistFields(value: unknown): ReceptionistFields {
  const row = asRecord(value);
  const fields: ReceptionistFields = {
    hours: readText(row, "hours"),
    services: readText(row, "services"),
    faqs: readText(row, "faqs"),
    policies: readText(row, "policies"),
    staff: readText(row, "staff"),
    notices: readText(row, "notices"),
    greeting: readText(row, "greeting"),
    assistantName: readText(row, "assistantName"),
    disclosureMode: readText(row, "disclosureMode"),
    voiceId: readText(row, "voiceId"),
    tone: readText(row, "tone"),
    languages: readText(row, "languages"),
    unansweredAfterRings: readText(row, "unansweredAfterRings"),
    lunchHours: readText(row, "lunchHours"),
    afterHours: readText(row, "afterHours"),
    weekends: readText(row, "weekends"),
    holidays: readText(row, "holidays"),
    holdOverflow: readText(row, "holdOverflow"),
    messages: readText(row, "messages"),
    bookingMode: readText(row, "bookingMode"),
    textConfirmations: readFlag(row, "textConfirmations"),
    textReminders: readFlag(row, "textReminders"),
    liveTransfer: readFlag(row, "liveTransfer"),
    emergencyHandling: readText(row, "emergencyHandling"),
    recallAddOn: readFlag(row, "recallAddOn"),
  };
  if (fields.assistantName.trim().length > 40) throw new Error("The assistant name is too long.");
  if (fields.disclosureMode !== "on_request" && fields.disclosureMode !== "upfront") throw new Error("Choose a disclosure mode.");
  if (fields.voiceId && !isVoiceKey(fields.voiceId)) throw new Error("Choose a voice.");
  if (fields.bookingMode && fields.bookingMode !== "direct_calendar" && fields.bookingMode !== "request_only") {
    throw new Error("Choose a booking mode.");
  }
  if (fields.unansweredAfterRings.trim()) {
    const rings = Number(fields.unansweredAfterRings);
    if (!Number.isInteger(rings) || rings < 1 || rings > 20) throw new Error("Rings must be a whole number from 1 to 20.");
  }
  return fields;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function editedClient(fields: ReceptionistFields): { voice: Record<string, unknown>; coverage: Record<string, unknown>; features: Record<string, unknown> } {
  const rings = fields.unansweredAfterRings.trim();
  return {
    voice: {
      ...(fields.voiceId ? { voiceId: fields.voiceId } : {}),
      ...(optionalText(fields.greeting) ? { greeting: optionalText(fields.greeting) } : {}),
      assistantName: optionalText(fields.assistantName) || "Ava",
      disclosureMode: fields.disclosureMode === "upfront" ? "upfront" : "on_request",
      ...(optionalText(fields.tone) ? { tone: optionalText(fields.tone) } : {}),
      ...(optionalText(fields.languages) ? { languages: optionalText(fields.languages) } : {}),
    },
    coverage: {
      ...(rings ? { unansweredAfterRings: Number(rings) } : {}),
      ...(optionalText(fields.lunchHours) ? { lunchHours: optionalText(fields.lunchHours) } : {}),
      ...(optionalText(fields.afterHours) ? { afterHours: optionalText(fields.afterHours) } : {}),
      ...(optionalText(fields.weekends) ? { weekends: optionalText(fields.weekends) } : {}),
      ...(optionalText(fields.holidays) ? { holidays: optionalText(fields.holidays) } : {}),
      ...(optionalText(fields.holdOverflow) ? { holdOverflow: optionalText(fields.holdOverflow) } : {}),
    },
    features: {
      ...(optionalText(fields.messages) ? { messages: optionalText(fields.messages) } : {}),
      ...(fields.bookingMode ? { bookingMode: fields.bookingMode } : {}),
      textConfirmations: fields.textConfirmations,
      textReminders: fields.textReminders,
      liveTransfer: fields.liveTransfer,
      ...(optionalText(fields.emergencyHandling) ? { emergencyHandling: optionalText(fields.emergencyHandling) } : {}),
      recallAddOn: fields.recallAddOn,
    },
  };
}

function knowledgePatch(fields: ReceptionistFields): Record<string, string | null> {
  return {
    hours: optionalText(fields.hours) ?? null,
    services: optionalText(fields.services) ?? null,
    faqs: optionalText(fields.faqs) ?? null,
    policies: optionalText(fields.policies) ?? null,
    staff: optionalText(fields.staff) ?? null,
    notices: optionalText(fields.notices) ?? null,
  };
}

function previewInput(
  loaded: Awaited<ReturnType<typeof load>>,
  fields: ReceptionistFields,
): PromptInput {
  const edited = editedClient(fields);
  const patch = knowledgePatch(fields);
  const knowledge: KnowledgeShape = {
    id: loaded.knowledge?.id ?? "",
    version: loaded.knowledge?.version ?? 0,
    hours: patch.hours,
    services: patch.services,
    faqs: patch.faqs,
    policies: patch.policies,
    staff: patch.staff,
    notices: patch.notices,
  };
  return toInput(
    {
      name: loaded.client.name,
      industry: loaded.client.industry,
      namePronunciation: loaded.client.namePronunciation,
      timezone: loaded.client.timezone,
      voice: edited.voice,
      features: edited.features,
      compliance: loaded.client.compliance,
      publicPhone: loaded.client.publicPhone,
      publicEmail: loaded.client.publicEmail,
    },
    knowledge,
    loaded.documents,
  );
}

export async function receptionistFields(ctx: TenantContext, clientId: string): Promise<ReceptionistFields> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can do that.");
  return prisma.$transaction(async (tx) => fieldsOf(await load(tx, clientId)));
}

export async function previewChangeRequest(ctx: Actor, input: { id: string; fields: unknown }): Promise<ChangeRequestPreview> {
  assertAdmin(ctx);
  const fields = parseReceptionistFields(input.fields);
  return prisma.$transaction(async (tx) => {
    const row = await tx.changeRequest.findFirst({ where: { id: input.id, status: "pending" } });
    if (!row) throw new Error("That request is not open.");
    const loaded = await load(tx, row.clientId);
    const current = renderPrompt(loaded.input);
    const nextInput = previewInput(loaded, fields);
    const rendered = renderPrompt(nextInput);
    return {
      prompt: rendered.text,
      truncated: rendered.truncated,
      lines: diffLines(current.text, rendered.text).filter((line) => line.op !== "same"),
      fields: diffFields(asRecord(settingsOf(loaded.input, current)), asRecord(settingsOf(nextInput, rendered))),
    };
  });
}

export async function approveChangeRequest(ctx: Actor, input: { id: string; fields: unknown }) {
  assertAdmin(ctx);
  const fields = parseReceptionistFields(input.fields);
  return prisma.$transaction(async (tx) => {
    const row = await tx.changeRequest.findFirst({ where: { id: input.id, status: "pending" } });
    if (!row) throw new Error("That request is not open.");
    const edited = editedClient(fields);
    const knowledge = await forkKnowledge(tx, row.clientId, knowledgePatch(fields));
    await tx.client.update({
      where: { id: row.clientId },
      data: {
        voice: jsonOr(edited.voice),
        coverage: jsonOr(edited.coverage),
        features: jsonOr(edited.features),
      },
    });
    const fresh = await load(tx, row.clientId);
    const config = await insertConfig(tx, {
      clientId: row.clientId,
      status: "active",
      source: "change_request",
      createdById: ctx.id,
      actor: ctx,
      input: fresh.input,
      knowledge,
      documentIds: fresh.documents.map((document) => document.id),
      voice: fresh.client.voice,
      features: fresh.client.features,
      coverage: fresh.client.coverage,
    });
    await tx.changeRequest.update({
      where: { id: row.id },
      data: {
        status: "approved",
        agentConfigId: config.id,
        reviewedById: ctx.id,
        reviewedAt: new Date(),
      },
    });
    await recordChange(tx, {
      clientId: row.clientId,
      actor: ctx,
      action: "change_request.approved",
      entityType: "change_request",
      entityId: row.id,
      summary: `Approved a ${row.category} change request`,
      after: { agentConfigId: config.id, version: config.version },
    });
    return config;
  });
}

export async function rejectChangeRequest(ctx: Actor, id: string): Promise<void> {
  assertAdmin(ctx);
  await prisma.$transaction(async (tx) => {
    const row = await tx.changeRequest.findFirst({ where: { id, status: "pending" } });
    if (!row) throw new Error("That request is not open.");
    await tx.changeRequest.update({
      where: { id: row.id },
      data: { status: "rejected", reviewedById: ctx.id, reviewedAt: new Date() },
    });
    await recordChange(tx, {
      clientId: row.clientId,
      actor: ctx,
      action: "change_request.rejected",
      entityType: "change_request",
      entityId: row.id,
      summary: "Rejected a change request",
    });
  });
}

async function forkKnowledgeSnapshot(
  tx: Prisma.TransactionClient,
  source: { clientId: string; knowledgeBaseId: string | null; settings: unknown },
) {
  const stored = source.knowledgeBaseId
    ? await tx.knowledgeBase.findFirst({ where: { id: source.knowledgeBaseId, clientId: source.clientId } })
    : null;
  const settings = asRecord(source.settings);
  const value = (field: "hours" | "services" | "faqs" | "policies" | "staff" | "notices") =>
    stored ? (field === "staff" ? staffOf(stored) : stored[field]) : (settings[field] ?? null);
  const latest = await tx.knowledgeBase.aggregate({ where: { clientId: source.clientId }, _max: { version: true } });
  return tx.knowledgeBase.create({
    data: {
      clientId: source.clientId,
      version: (latest._max.version ?? 0) + 1,
      status: "submitted",
      hours: jsonOr(value("hours")),
      services: jsonOr(value("services")),
      faqs: jsonOr(value("faqs")),
      policies: jsonOr(value("policies")),
      staff: Prisma.DbNull,
      staffCipher: sealJson(value("staff")),
      notices: jsonOr(value("notices")),
    },
  });
}

async function restoreClientFromConfig(
  tx: Prisma.TransactionClient,
  source: { clientId: string; voice: unknown; greeting: string | null; settings: unknown },
) {
  const client = await tx.client.findFirst({ where: { id: source.clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const settings = asRecord(source.settings);
  const voice = { ...asRecord(source.voice) };
  if (typeof source.greeting === "string" && source.greeting.trim()) voice.greeting = source.greeting;
  const features = settings.features && typeof settings.features === "object" && !Array.isArray(settings.features)
    ? settings.features
    : client.features;
  const coverage = settings.coverage && typeof settings.coverage === "object" && !Array.isArray(settings.coverage)
    ? settings.coverage
    : client.coverage;
  const compliance = { ...asRecord(client.compliance) };
  if (typeof settings.recordingNotice === "boolean") compliance.recordingNotice = settings.recordingNotice;
  await tx.client.update({
    where: { id: client.id },
    data: {
      voice: jsonOr(voice),
      features: jsonOr(features),
      coverage: jsonOr(coverage),
      compliance: jsonOr(compliance),
      namePronunciation: typeof settings.namePronunciation === "string" ? settings.namePronunciation || null : client.namePronunciation,
    },
  });
}

async function copyAsActive(ctx: Actor, input: { clientId: string; version: number }, sourceName: "activate" | "rollback") {
  assertAdmin(ctx);
  return prisma.$transaction(async (tx) => {
    const source = await tx.agentConfig.findFirst({ where: { clientId: input.clientId, version: input.version } });
    if (!source) throw new Error("That version was not found.");
    if (source.status === "active") throw new Error("That version is already active.");
    if (sourceName === "activate" && source.status !== "draft") throw new Error("Only a draft can be activated.");
    await tx.agentConfig.updateMany({ where: { clientId: input.clientId, status: "active" }, data: { status: "superseded" } });
    if (source.status === "draft") {
      await tx.agentConfig.update({ where: { id: source.id }, data: { status: "superseded" } });
    }
    let knowledgeBaseId = source.knowledgeBaseId;
    let knowledgeVersion = source.knowledgeVersion;
    if (sourceName === "rollback") {
      const forked = await forkKnowledgeSnapshot(tx, source);
      await restoreClientFromConfig(tx, source);
      knowledgeBaseId = forked.id;
      knowledgeVersion = forked.version;
    }
    const created = await tx.agentConfig.create({
      data: {
        clientId: source.clientId,
        version: await nextVersion(tx, source.clientId),
        status: "active",
        promptText: source.promptText,
        promptTruncated: source.promptTruncated,
        templateId: source.templateId,
        templateVersion: source.templateVersion,
        knowledgeBaseId,
        knowledgeVersion,
        documentIds: source.documentIds as Prisma.InputJsonValue,
        voice: jsonOr(source.voice),
        greeting: source.greeting,
        referenceToken: source.referenceToken,
        tools: source.tools as Prisma.InputJsonValue,
        settings: source.settings as Prisma.InputJsonValue,
        platformAgentId: null,
        source: sourceName,
        createdById: ctx.id,
      },
    });
    await recordChange(tx, {
      clientId: source.clientId,
      actor: ctx,
      action: sourceName === "activate" ? "agent_config.activated" : "agent_config.rollback",
      entityType: "agent_config",
      entityId: created.id,
      summary: sourceName === "activate"
        ? `Activated receptionist config v${created.version} from draft v${source.version}`
        : `Rolled back to a copy of v${source.version} as v${created.version}`,
      after: { fromVersion: source.version, version: created.version },
    });
    await flagAgentSync(tx, source.clientId, ctx);
    return created;
  });
}

export async function activateAgentConfig(ctx: Actor, input: { clientId: string; version: number }) {
  return copyAsActive(ctx, input, "activate");
}

export async function rollbackAgentConfig(ctx: Actor, input: { clientId: string; version: number }) {
  return copyAsActive(ctx, input, "rollback");
}

export async function diffAgentConfigs(
  ctx: Actor,
  input: { clientId: string; fromVersion: number; toVersion: number },
): Promise<{ lines: LineDiff[]; fields: FieldDiff[] }> {
  assertAdmin(ctx);
  const [from, to] = await Promise.all([
    prisma.agentConfig.findFirst({ where: { clientId: input.clientId, version: input.fromVersion } }),
    prisma.agentConfig.findFirst({ where: { clientId: input.clientId, version: input.toVersion } }),
  ]);
  if (!from || !to) throw new Error("That version was not found.");
  return {
    lines: diffLines(from.promptText, to.promptText),
    fields: diffFields(asRecord(from.settings), asRecord(to.settings)),
  };
}
