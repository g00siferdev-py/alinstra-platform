import { buildGreeting, type PromptFeatures } from "@alinstra/agent";
import type { BillingPlatform, PublishedTool, VoicePlatform } from "@alinstra/providers";
import { END_CALL_TOOL, overageLookupKey, retellVoiceIdFor, TAKE_MESSAGE_PARAMETERS, TRANSFER_CHECK_PARAMETERS, transferToolNames } from "@alinstra/providers";
import { Pool } from "pg";
import { Prisma } from "./generated/prisma/client";
import { refreshStaleAgentConfig } from "./agent";
import { recordChange, type Actor } from "./changes";
import { messageData, transferNumberOf, transferTargetData, withMessageText, withTransferNumber } from "./cipher";
import { prisma } from "./client";
import {
  assertTransferNumber,
  callTimingOf,
  clientIsHealthcare,
  emptyWizardPayload,
  formatTransferTargets,
  normalizeTransferNumber,
  officeOpen,
  parseRecipientEmails,
  parseTransferTargets,
  plainCallerName,
  retellPrompt,
  type WeeklyHours,
} from "./domain";
import { assertTenantContext, type TenantContext } from "./tenant";
import { testDatabaseUrl } from "./test-database-url";

export const PROVISION_STEPS = ["stripe_customer", "stripe_checkout", "retell_llm", "retell_agent", "retell_number", "retell_bind"] as const;
export const TEARDOWN_STEPS = ["retell_number", "retell_agent", "retell_llm"] as const;

/** Human labels for provisioning steps, shared by the admin UI and the failure email. */
export const PROVISION_STEP_LABELS: Record<string, string> = {
  stripe_customer: "Create billing account",
  stripe_checkout: "Create payment link",
  retell_llm: "Build receptionist",
  retell_agent: "Create voice agent",
  retell_number: "Buy phone number",
  retell_bind: "Connect and publish",
};

export function provisionStepLabel(name: string): string {
  return PROVISION_STEP_LABELS[name] ?? name;
}

/** Step status used while a run waits for the admin to approve buying a phone number. */
export const AWAITING_NUMBER_APPROVAL = "awaiting_approval";

/** Retell number pricing shown in the approval modal. Toll-free also bills inbound minutes. */
export const NUMBER_PRICING = {
  tollFree: { monthlyCents: 500, inboundPerMinuteCents: 6 },
  local: { monthlyCents: 200, inboundPerMinuteCents: 0 },
} as const;

const WEBHOOK_ACTOR: Actor = { id: "provider-webhook", role: "admin" };

export type Phase3Deps = {
  voice: VoicePlatform;
  billing: BillingPlatform;
  appUrl: string;
  danielNumber: string | null;
  danielEmail: string | null;
  defaultAreaCode: string | null;
  defaultTollFree: boolean;
};

let lockPool: Pool | undefined;

function provisionLockPool(): Pool {
  if (!lockPool) {
    const configured = process.env.DATABASE_URL ?? "";
    const connectionString = process.env.NODE_ENV === "test" ? testDatabaseUrl(configured, process.env.DATABASE_URL_TEST) : configured;
    lockPool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 1_000, allowExitOnIdle: true });
  }
  return lockPool;
}

async function withClientLock<T>(clientId: string, work: () => Promise<T>): Promise<T | "busy"> {
  const client = await provisionLockPool().connect();
  const key = `alinstra:${clientId}`;
  let held = false;
  try {
    const locked = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
    held = Boolean(locked.rows[0]?.locked);
    if (!held) return "busy";
    return await work();
  } finally {
    if (held) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
    client.release();
  }
}

function origin(appUrl: string): string {
  return appUrl.replace(/\/$/, "");
}

function owns(ctx: TenantContext, clientId: string): boolean {
  assertTenantContext(ctx);
  return ctx.role === "admin" || ctx.clientId === clientId;
}

export function transferTargets(ctx: TenantContext) {
  return {
    list(clientId: string) {
      if (!owns(ctx, clientId)) return Promise.resolve([]);
      // `e164` is decrypted here for portal/admin display (formatTransferTargets); the list view uses `e164Masked`.
      return prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } }).then((rows) => rows.map(withTransferNumber));
    },
  };
}

export function clientMessages(ctx: TenantContext) {
  return {
    /** Newest first. `callerName`, `callbackNumber`, and `body` are decrypted (plaintext fallback for older rows); `callbackMasked` is the list-safe form. */
    list(clientId: string) {
      if (!owns(ctx, clientId)) return Promise.resolve([]);
      return prisma.clientMessage.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 50 }).then((rows) => rows.map(withMessageText));
    },
  };
}

/**
 * Loads one message for the email worker by id (no tenant context: the job already carries trusted recipients).
 * Returns null when the row is gone. Decrypts caller name and body for the email body only.
 */
export async function messageForEmail(messageId: string): Promise<{
  clientId: string;
  callerName: string;
  body: string;
} | null> {
  const row = await prisma.clientMessage.findUnique({ where: { id: messageId } });
  if (!row) return null;
  const message = withMessageText(row);
  return { clientId: row.clientId, callerName: message.callerName, body: message.body };
}

export function callRecords(ctx: TenantContext) {
  return {
    list(clientId: string) {
      if (!owns(ctx, clientId)) return Promise.resolve([]);
      return prisma.callRecord.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 50 });
    },
  };
}

export function provisioningRuns(ctx: TenantContext) {
  return {
    latest(clientId: string) {
      if (!owns(ctx, clientId)) return Promise.resolve(null);
      return prisma.provisioningRun.findFirst({
        where: { clientId },
        orderBy: { createdAt: "desc" },
        include: { steps: { orderBy: { name: "asc" } } },
      });
    },
  };
}

export async function flagAgentSync(tx: Prisma.TransactionClient, clientId: string, actor: Actor): Promise<boolean> {
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { retellLlmId: true, name: true } });
  if (!client?.retellLlmId) return false;
  await tx.client.update({ where: { id: clientId }, data: { agentSyncStatus: "syncing", agentSyncError: null } });
  await recordChange(tx, {
    clientId,
    actor,
    action: "agent.sync_needed",
    entityType: "client",
    entityId: clientId,
    summary: `Receptionist settings for ${client.name} need a Retell sync`,
    after: { agentSyncStatus: "syncing" },
  });
  return true;
}

export async function writeTransferTargets(tx: Prisma.TransactionClient, ctx: Actor, clientId: string, text: string): Promise<boolean> {
  const rows = parseTransferTargets(text);
  const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  await tx.transferTarget.deleteMany({ where: { clientId } });
  if (rows.length > 0) {
    await tx.transferTarget.createMany({ data: rows.map((row) => ({ clientId, ...transferTargetData(row) })) });
  }
  const sync = await flagAgentSync(tx, clientId, ctx);
  await recordChange(tx, {
    clientId,
    actor: ctx,
    action: "transfer_targets.replaced",
    entityType: "client",
    entityId: clientId,
    summary: `Updated transfer targets for ${client.name}`,
    after: { count: rows.length },
  });
  return sync;
}

export async function replaceTransferTargets(
  ctx: Actor,
  input: { clientId: string; text: string },
): Promise<{ sync: boolean }> {
  assertTenantContext(ctx);
  if (ctx.role === "client_staff") throw new Error("Only an owner or admin can edit transfer targets.");
  if (ctx.role !== "admin" && ctx.clientId !== input.clientId) throw new Error("That client is not available.");
  const sync = await prisma.$transaction((tx) => writeTransferTargets(tx, ctx, input.clientId, input.text));
  return { sync };
}

function liveTransferOn(features: unknown): boolean {
  return Boolean(features && typeof features === "object" && (features as { liveTransfer?: boolean }).liveTransfer);
}

function toolsFor(appUrl: string, targets: Array<{ label: string; e164: string }>, features: unknown): PublishedTool[] {
  const base = origin(appUrl);
  const tools: PublishedTool[] = [
    {
      name: "take_message",
      description: "Save a message for the office. Ask for the caller's name, callback number, and message before calling. Use this when the office is closed, a transfer is not allowed, or you are unsure. Do not invent a booking.",
      url: `${base}/api/retell/tools/take-message`,
      timeoutMs: 8000,
      parameters: TAKE_MESSAGE_PARAMETERS,
    },
  ];
  if (!liveTransferOn(features) || targets.length === 0) return [...tools, END_CALL_TOOL];
  const names = transferToolNames(targets.map((target) => target.label));
  const labels = targets.map((target) => target.label.trim()).join("; ");
  tools.push({
    name: "transfer",
    description: `Ask the caller before transferring. Call this with target set to one of: ${labels}. If the response says allowed is true, use the tool it names right away. If allowed is false, read the reason and take a message instead. Never tell the caller any phone number.`,
    url: `${base}/api/retell/tools/transfer`,
    timeoutMs: 8000,
    parameters: TRANSFER_CHECK_PARAMETERS,
  });
  targets.forEach((target, index) => {
    tools.push({
      name: names[index] ?? `transfer_${index + 1}`,
      description: `Cold transfer to ${target.label.trim()}. Use this only after the transfer tool allowed it and named this tool, and only during business hours.`,
      transferTo: target.e164,
    });
  });
  tools.push(END_CALL_TOOL);
  return tools;
}

async function loadReady(clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const config = await prisma.agentConfig.findFirst({ where: { clientId, status: "active" } });
  const plan = client.planId ? await prisma.plan.findFirst({ where: { id: client.planId } }) : null;
  const targets = await prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  return { client, config, plan, targets };
}

const CLIENT_ZERO_TIMEZONE = "America/New_York";

/**
 * Gives an unsubmitted client the WizardDraft and draft knowledge base that `startWizard` would have created,
 * pre-filled from the client row, so the admin "Continue wizard" link works. Returns true when a draft was added.
 */
async function ensureWizardDraft(
  tx: Prisma.TransactionClient,
  ctx: Actor,
  client: { id: string; name: string; timezone: string; phone: unknown; wizardSubmittedAt: Date | null },
): Promise<boolean> {
  if (client.wizardSubmittedAt) return false;
  const draft = await tx.wizardDraft.findFirst({ where: { clientId: client.id, discardedAt: null }, select: { id: true } });
  if (draft) return false;
  const tollFree = Boolean(client.phone && typeof client.phone === "object" && (client.phone as { tollFree?: boolean }).tollFree);
  const payload = {
    ...emptyWizardPayload(),
    business: { name: client.name, timezone: client.timezone },
    phone: { mode: "new_number", tollFree },
  };
  await tx.wizardDraft.create({
    data: { clientId: client.id, currentStep: 1, payload: payload as Prisma.InputJsonValue, createdById: ctx.id },
  });
  const knowledge = await tx.knowledgeBase.findFirst({ where: { clientId: client.id }, select: { id: true } });
  if (!knowledge) await tx.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "draft" } });
  return true;
}

export async function createClientZero(ctx: Actor): Promise<{ id: string; created: boolean }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can create client zero.");
  const existing = await prisma.client.findFirst({ where: { internal: true, archivedAt: null } });
  if (existing) {
    // Older client zero rows were created without a draft; add one so Continue stops 404ing.
    await prisma.$transaction((tx) => ensureWizardDraft(tx, ctx, existing));
    return { id: existing.id, created: false };
  }
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { name: "Alinstra", internal: true, status: "lead", timezone: CLIENT_ZERO_TIMEZONE, phone: { mode: "new_number", tollFree: true } },
    });
    await ensureWizardDraft(tx, ctx, client);
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "client.internal_created",
      entityType: "client",
      entityId: client.id,
      summary: "Created Alinstra as client zero",
    });
    return { id: client.id, created: true };
  });
}

export async function clientIdForRetellAgent(agentId: string): Promise<string | null> {
  const client = await prisma.client.findFirst({ where: { retellAgentId: agentId, archivedAt: null }, select: { id: true } });
  return client?.id ?? null;
}

/** What the number step will buy for this client, so the admin can approve it with the price in front of them. */
export function numberPurchaseFor(phone: unknown, defaults: { areaCode: string | null; tollFree: boolean }): {
  tollFree: boolean;
  areaCode: string | null;
  monthlyCents: number;
  inboundPerMinuteCents: number;
} {
  const choice = numberChoice(phone, defaults);
  const pricing = choice.tollFree ? NUMBER_PRICING.tollFree : NUMBER_PRICING.local;
  return {
    tollFree: choice.tollFree,
    areaCode: choice.areaCode === null ? null : String(choice.areaCode),
    monthlyCents: pricing.monthlyCents,
    inboundPerMinuteCents: pricing.inboundPerMinuteCents,
  };
}

/**
 * Starts a provisioning run. `numberApproved` records that the admin confirmed the number purchase in the
 * modal; without it the run stops before `retell_number` and waits for `approveNumberPurchase`.
 */
export async function startProvisioning(ctx: Actor, clientId: string, options: { numberApproved?: boolean } = {}): Promise<{ runId: string }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can provision a client.");
  const { client, config } = await loadReady(clientId);
  if (!client.wizardSubmittedAt) throw new Error("Submit the wizard before provisioning.");
  if (clientIsHealthcare(client)) throw new Error("Healthcare clients cannot be provisioned in this phase.");
  if (!config) throw new Error("Activate a receptionist config before provisioning.");
  if (client.status === "churned") throw new Error("This client has ended service.");
  const existing = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision", status: { in: ["running", "failed"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (options.numberApproved && !existing.numberApprovedAt) await approveNumberPurchase(ctx, clientId);
    return { runId: existing.id };
  }
  try {
  return await prisma.$transaction(async (tx) => {
    const run = await tx.provisioningRun.create({
      data: {
        clientId,
        kind: "provision",
        status: "running",
        createdById: ctx.id,
        numberApprovedAt: options.numberApproved ? new Date() : null,
        steps: { create: PROVISION_STEPS.map((name) => ({ name, status: "pending" })) },
      },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "provision.started",
      entityType: "provisioning_run",
      entityId: run.id,
      summary: `Started provisioning for ${client.name}${options.numberApproved ? " (number purchase approved)" : ""}`,
      after: { numberApproved: Boolean(options.numberApproved) },
    });
    return { runId: run.id };
  });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.provisioningRun.findFirst({
        where: { clientId, kind: "provision", status: { in: ["running", "failed"] } },
        orderBy: { createdAt: "desc" },
      });
      if (raced) return { runId: raced.id };
    }
    throw error;
  }
}

/**
 * Records the admin's explicit click on the "Buy number" modal. The provisioning run will not call
 * createNumber until this has happened.
 */
export async function approveNumberPurchase(ctx: Actor, clientId: string): Promise<{ runId: string }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can approve a number purchase.");
  const run = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision", status: { in: ["running", "failed"] } },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  if (!run) throw new Error("Start provisioning first.");
  const client = await prisma.client.findFirstOrThrow({ where: { id: clientId }, select: { name: true } });
  await prisma.$transaction(async (tx) => {
    await tx.provisioningRun.update({ where: { id: run.id }, data: { numberApprovedAt: run.numberApprovedAt ?? new Date(), status: "running", finishedAt: null } });
    const waiting = run.steps.find((step) => step.name === "retell_number" && step.status === AWAITING_NUMBER_APPROVAL);
    if (waiting) await tx.provisioningStep.update({ where: { id: waiting.id }, data: { status: "pending", error: null } });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "provision.number_approved",
      entityType: "provisioning_run",
      entityId: run.id,
      summary: `Approved buying a phone number for ${client.name}`,
    });
  });
  return { runId: run.id };
}

export type ProvisionFailure = {
  clientId: string;
  clientName: string;
  stepName: string;
  stepLabel: string;
  error: string;
  runOwnerEmail: string | null;
};

/** Details of the latest failed provisioning run, for the failure email. Null when the latest run did not fail. */
export async function latestProvisionFailure(clientId: string): Promise<ProvisionFailure | null> {
  const run = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision" },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  if (!run || run.status !== "failed") return null;
  const client = await prisma.client.findFirst({ where: { id: clientId }, select: { name: true } });
  const step = run.steps.find((item) => item.status === "failed");
  const owner = await prisma.user.findUnique({ where: { id: run.createdById }, select: { email: true } });
  return {
    clientId,
    clientName: client?.name ?? clientId,
    stepName: step?.name ?? "unknown",
    stepLabel: step ? provisionStepLabel(step.name) : "Unknown step",
    error: step?.error ?? "No error detail was recorded.",
    runOwnerEmail: owner?.email ?? null,
  };
}

export async function failProvisioning(clientId: string, message: string): Promise<void> {
  const run = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision", status: "running" },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  if (!run) return;
  const step = run.steps.find((item) => item.status === "running") ?? run.steps.find((item) => item.status === "pending");
  await prisma.$transaction(async (tx) => {
    await tx.provisioningRun.update({ where: { id: run.id }, data: { status: "failed" } });
    if (step) {
      await tx.provisioningStep.update({
        where: { id: step.id },
        data: { status: "failed", error: message.slice(0, 500), finishedAt: new Date() },
      });
    }
    await recordChange(tx, {
      clientId,
      actor: WEBHOOK_ACTOR,
      action: "provision.failed",
      entityType: "provisioning_run",
      entityId: run.id,
      summary: message.slice(0, 300),
    });
  });
}

async function markStep(runId: string, name: string, data: { status: string; externalId?: string | null; error?: string | null }, actor: Actor, clientId: string, summary: string) {
  await prisma.$transaction(async (tx) => {
    const step = await tx.provisioningStep.findFirst({ where: { runId, name } });
    if (!step) throw new Error("That provisioning step is missing.");
    await tx.provisioningStep.update({
      where: { id: step.id },
      data: {
        status: data.status,
        externalId: data.externalId === undefined ? step.externalId : data.externalId,
        error: data.error === undefined ? step.error : data.error,
        startedAt: data.status === "running" ? new Date() : step.startedAt,
        finishedAt: data.status === "succeeded" || data.status === "failed" ? new Date() : null,
      },
    });
    await recordChange(tx, {
      clientId,
      actor,
      action: `provision.${name}.${data.status}`,
      entityType: "provisioning_step",
      entityId: step.id,
      summary,
      after: { status: data.status, externalId: data.externalId ?? null },
    });
  });
}

function monthlyCents(client: { overrideMonthlyPriceCents: number | null }, plan: { monthlyPriceCents: number }): number {
  return client.overrideMonthlyPriceCents ?? plan.monthlyPriceCents;
}

function lookupKeyFor(kind: "monthly" | "setup", planCode: string, clientId: string, overridden: boolean): string {
  return overridden ? `client_${clientId}_${kind}` : `plan_${planCode}_${kind}`;
}

function numberChoice(phone: unknown, defaults: { areaCode: string | null; tollFree: boolean }): { tollFree: boolean; areaCode: number | null } {
  const row = phone && typeof phone === "object" ? (phone as { tollFree?: unknown; areaCode?: unknown }) : {};
  const tollFree = typeof row.tollFree === "boolean" ? row.tollFree : defaults.tollFree;
  if (tollFree) return { tollFree: true, areaCode: null };
  const chosen = typeof row.areaCode === "string" && /^\d{3}$/.test(row.areaCode) ? row.areaCode : defaults.areaCode ?? "";
  return { tollFree: false, areaCode: /^\d{3}$/.test(chosen) ? Number(chosen) : null };
}

const CHECKOUT_REFRESH_MS = 10 * 60 * 1000;

function checkoutStillFresh(url: string | null, expiresAt: Date | null, now = Date.now()): boolean {
  return Boolean(url && expiresAt && expiresAt.getTime() > now + CHECKOUT_REFRESH_MS);
}

function setupCents(client: { setupFeeWaived: boolean; overrideSetupFeeCents: number | null }, plan: { setupFeeCents: number }): number | null {
  if (client.setupFeeWaived) return null;
  return client.overrideSetupFeeCents ?? plan.setupFeeCents;
}

async function openCheckout(clientId: string, deps: Phase3Deps, now = Date.now()): Promise<{ url: string; expiresAt: Date }> {
  const { client, plan } = await loadReady(clientId);
  if (client.internal) throw new Error("Client zero is not billed.");
  if (!plan) throw new Error("Choose a plan before billing.");
  if (!client.stripeCustomerId) throw new Error("Create the Stripe customer first.");
  const recurringAmount = monthlyCents(client, plan);
  const setupAmount = setupCents(client, plan);
  const recurringKey = lookupKeyFor("monthly", plan.code, clientId, client.overrideMonthlyPriceCents != null);
  const recurring = await deps.billing.ensurePrice({
    lookupKey: recurringKey,
    amountCents: recurringAmount,
    kind: "recurring",
    productName: `${plan.name} monthly`,
    idempotencyKey: `price_${recurringKey}_${recurringAmount}`,
  });
  await rememberPrice(recurringKey, recurring.priceId, plan.code, "recurring", recurringAmount);
  let setupPriceId: string | null = null;
  if (setupAmount !== null) {
    const setupKey = lookupKeyFor("setup", plan.code, clientId, client.overrideSetupFeeCents != null);
    const setup = await deps.billing.ensurePrice({
      lookupKey: setupKey,
      amountCents: setupAmount,
      kind: "setup",
      productName: `${plan.name} setup`,
      idempotencyKey: `price_${setupKey}_${setupAmount}`,
    });
    await rememberPrice(setupKey, setup.priceId, plan.code, "setup", setupAmount);
    setupPriceId = setup.priceId;
  }
  const base = origin(deps.appUrl);
  const session = await deps.billing.createCheckout({
    clientId,
    customerId: client.stripeCustomerId,
    recurringPriceId: recurring.priceId,
    setupPriceId,
    successUrl: `${base}/billing/thanks`,
    cancelUrl: `${base}/billing/canceled`,
    idempotencyKey: `client_${clientId}_checkout_${recurring.priceId}_${now}`,
  });
  await prisma.client.update({
    where: { id: clientId },
    data: { stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt, billingStatus: "checkout_open" },
  });
  return { url: session.url, expiresAt: session.expiresAt };
}

export async function refreshPaymentLink(ctx: Actor, clientId: string, deps: Phase3Deps): Promise<{ url: string }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can send a payment link.");
  const { client } = await loadReady(clientId);
  if (client.internal) throw new Error("Client zero is not billed.");
  if (client.billingStatus === "paid") throw new Error("This client is already paid.");
  const session = await openCheckout(clientId, deps);
  return { url: session.url };
}

async function rememberPrice(lookupKey: string, stripePriceId: string, planCode: string, kind: string, amountCents: number) {
  const existing = await prisma.stripePrice.findUnique({ where: { lookupKey } });
  if (!existing) {
    await prisma.stripePrice.create({ data: { lookupKey, stripePriceId, planCode, kind, amountCents } });
    return;
  }
  if (existing.stripePriceId !== stripePriceId || existing.amountCents !== amountCents) {
    await prisma.stripePrice.update({ where: { id: existing.id }, data: { stripePriceId, amountCents } });
  }
}

export async function advanceProvisioning(ctx: Actor, clientId: string, deps: Phase3Deps): Promise<{ status: string }> {
  const locked = await withClientLock(clientId, () => advanceProvisioningBody(ctx, clientId, deps));
  if (locked === "busy") return { status: "busy" };
  return locked;
}

async function advanceProvisioningBody(ctx: Actor, clientId: string, deps: Phase3Deps): Promise<{ status: string }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can provision a client.");
  const run = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision", status: { in: ["running", "failed"] } },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  if (!run) throw new Error("Start provisioning first.");
  if (run.status === "failed") {
    await prisma.provisioningRun.update({ where: { id: run.id }, data: { status: "running", finishedAt: null } });
  }
  const actor: Actor = { id: run.createdById, role: "admin" };
  for (const name of PROVISION_STEPS) {
    const step = run.steps.find((item) => item.name === name);
    if (step?.status === "succeeded") continue;
    if (name === "retell_number" && !run.numberApprovedAt) {
      const current = await prisma.client.findFirst({ where: { id: clientId }, select: { phoneE164: true } });
      if (!current?.phoneE164) {
        // Buying a number costs money every month. Stop here until the admin confirms it in the modal.
        if (step?.status !== AWAITING_NUMBER_APPROVAL) {
          await markStep(run.id, name, { status: AWAITING_NUMBER_APPROVAL, error: null }, actor, clientId, "Waiting for approval to buy a phone number");
        }
        return { status: AWAITING_NUMBER_APPROVAL };
      }
    }
    await markStep(run.id, name, { status: "running", error: null }, actor, clientId, `Running ${name}`);
    try {
      const externalId = await runProvisionStep(name, clientId, deps);
      await markStep(run.id, name, { status: "succeeded", externalId, error: null }, actor, clientId, `Finished ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provisioning step failed";
      await markStep(run.id, name, { status: "failed", error: message }, actor, clientId, `Failed ${name}`);
      await prisma.provisioningRun.update({ where: { id: run.id }, data: { status: "failed" } });
      return { status: "failed" };
    }
  }
  await prisma.provisioningRun.update({ where: { id: run.id }, data: { status: "succeeded", finishedAt: new Date() } });
  return { status: "succeeded" };
}

async function ensureDanielTarget(clientId: string, number: string | null) {
  const count = await prisma.transferTarget.count({ where: { clientId } });
  if (count > 0 || !number) return;
  assertTransferNumber(number);
  await prisma.transferTarget.create({ data: { clientId, ...transferTargetData({ label: "Daniel", e164: number }) } });
}

async function publishInput(clientId: string, deps: Phase3Deps) {
  await refreshStaleAgentConfig(WEBHOOK_ACTOR, clientId);
  const loaded = await loadReady(clientId);
  if (!loaded.config) throw new Error("Activate a receptionist config before provisioning.");
  if (loaded.client.internal) await ensureDanielTarget(clientId, deps.danielNumber);
  const targets = await prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  const transferRows = targets.map((target) => {
    const e164 = transferNumberOf(target);
    if (!e164) {
      throw new Error("A transfer number could not be decrypted; check ENCRYPTION_KEY settings on web and worker");
    }
    return { label: target.label, e164 };
  });
  const base = origin(deps.appUrl);
  const voice = loaded.client.voice && typeof loaded.client.voice === "object" ? (loaded.client.voice as { voiceId?: unknown }) : {};
  return {
    loaded,
    // The client's wizard selection decides the Retell voice; unset falls back to the default voice.
    voiceId: retellVoiceIdFor(voice.voiceId),
    prompt: retellPrompt(loaded.config.promptText, loaded.client.timezone),
    beginMessage: loaded.config.greeting?.trim() || "Thank you for calling.",
    // Transfer numbers are decrypted only here, to publish the transfer tools to Retell.
    tools: toolsFor(deps.appUrl, transferRows, loaded.client.features),
    timing: callTimingOf(loaded.client.coverage),
    webhookUrl: `${base}/api/retell/webhook`,
    inboundWebhookUrl: `${base}/api/retell/inbound`,
  };
}

async function runProvisionStep(name: (typeof PROVISION_STEPS)[number], clientId: string, deps: Phase3Deps): Promise<string> {
  const { client } = await loadReady(clientId);
  if (name === "stripe_customer") {
    if (client.internal) return "skipped";
    if (client.stripeCustomerId) return client.stripeCustomerId;
    const found = await deps.billing.findCustomerId(clientId);
    const customerId = found ?? (await deps.billing.createCustomer({
      clientId,
      name: client.name,
      email: client.contactEmail,
      idempotencyKey: `client_${clientId}_customer`,
    })).customerId;
    await prisma.client.update({ where: { id: clientId }, data: { stripeCustomerId: customerId } });
    return customerId;
  }
  if (name === "stripe_checkout") {
    if (client.internal) return "skipped";
    if (client.billingStatus === "paid") return client.stripeSubscriptionId ?? "paid";
    if (checkoutStillFresh(client.stripeCheckoutUrl, client.stripeCheckoutExpiresAt)) return client.stripeCheckoutUrl ?? "open";
    const session = await openCheckout(clientId, deps);
    return session.url;
  }
  const published = await publishInput(clientId, deps);
  if (name === "retell_llm") {
    if (client.retellLlmId) return client.retellLlmId;
    const llmId = (await deps.voice.createLlm({
      clientId,
      prompt: published.prompt,
      beginMessage: published.beginMessage,
      tools: published.tools,
    })).llmId;
    await prisma.client.update({ where: { id: clientId }, data: { retellLlmId: llmId } });
    return llmId;
  }
  if (name === "retell_agent") {
    if (client.retellAgentId) return client.retellAgentId;
    if (!client.retellLlmId) throw new Error("Create the Retell LLM first.");
    const found = await deps.voice.findAgentId(clientId);
    const agentId = found ?? (await deps.voice.createAgent({
      clientId,
      llmId: client.retellLlmId,
      voiceId: published.voiceId,
      webhookUrl: published.webhookUrl,
      timing: published.timing,
    })).agentId;
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: clientId }, data: { retellAgentId: agentId } });
      if (published.loaded.config) {
        await tx.agentConfig.update({ where: { id: published.loaded.config.id }, data: { platformAgentId: agentId } });
      }
    });
    return agentId;
  }
  if (name === "retell_number") {
    if (client.phoneE164) return client.phoneE164;
    if (!client.retellAgentId) throw new Error("Create the Retell agent first.");
    const found = await deps.voice.findNumber(clientId);
    const choice = numberChoice(client.phone, { areaCode: deps.defaultAreaCode, tollFree: deps.defaultTollFree });
    const e164 = found ?? (await deps.voice.createNumber({
      clientId,
      agentId: client.retellAgentId,
      inboundWebhookUrl: published.inboundWebhookUrl,
      tollFree: choice.tollFree,
      areaCode: choice.areaCode,
    })).e164;
    await prisma.client.update({
      where: { id: clientId },
      data: { phoneE164: e164, ...(client.internal && !client.publicPhone ? { publicPhone: e164 } : {}) },
    });
    return e164;
  }
  if (!client.retellLlmId || !client.retellAgentId) throw new Error("Create the Retell agent before binding it.");
  await deps.voice.syncAgent({
    clientId,
    llmId: client.retellLlmId,
    agentId: client.retellAgentId,
    prompt: published.prompt,
    beginMessage: published.beginMessage,
    voiceId: published.voiceId,
    tools: published.tools,
    timing: published.timing,
    webhookUrl: published.webhookUrl,
    inboundWebhookUrl: published.inboundWebhookUrl,
  });
  const fresh = await prisma.client.findFirstOrThrow({ where: { id: clientId } });
  const live = fresh.internal || fresh.billingStatus === "paid";
  await prisma.client.update({
    where: { id: clientId },
    data: {
      agentSyncStatus: "in_sync",
      agentSyncError: null,
      syncedConfigId: published.loaded.config?.id ?? null,
      status: live ? "live" : "awaiting_payment",
      liveAt: live ? fresh.liveAt ?? new Date() : null,
    },
  });
  return fresh.phoneE164 ?? "bound";
}

export async function syncProvisionedAgent(clientId: string, deps: Phase3Deps): Promise<"in_sync" | "failed" | "skipped"> {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client?.retellLlmId || !client.retellAgentId) return "skipped";
  await refreshStaleAgentConfig(WEBHOOK_ACTOR, clientId);
  const config = await prisma.agentConfig.findFirst({ where: { clientId, status: "active" } });
  if (!config) return "skipped";
  if (client.agentSyncStatus === "in_sync" && client.syncedConfigId === config.id) return "in_sync";
  try {
    const published = await publishInput(clientId, deps);
    await deps.voice.syncAgent({
      clientId,
      llmId: client.retellLlmId,
      agentId: client.retellAgentId,
      prompt: published.prompt,
      beginMessage: published.beginMessage,
      voiceId: published.voiceId,
      tools: published.tools,
      timing: published.timing,
      webhookUrl: published.webhookUrl,
      inboundWebhookUrl: published.inboundWebhookUrl,
    });
    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: { agentSyncStatus: "in_sync", agentSyncError: null, syncedConfigId: config.id },
      });
      await recordChange(tx, {
        clientId,
        actor: WEBHOOK_ACTOR,
        action: "agent.synced",
        entityType: "client",
        entityId: clientId,
        summary: `Retell is in sync for ${client.name}`,
        after: { agentSyncStatus: "in_sync", configId: config.id },
      });
    });
    return "in_sync";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: clientId }, data: { agentSyncStatus: "failed", agentSyncError: message } });
      await recordChange(tx, {
        clientId,
        actor: WEBHOOK_ACTOR,
        action: "agent.sync_failed",
        entityType: "client",
        entityId: clientId,
        summary: `Retell sync failed for ${client.name}`,
        after: { agentSyncStatus: "failed" },
      });
    });
    return "failed";
  }
}

async function teardown(clientId: string, deps: Phase3Deps, actor: Actor): Promise<void> {
  const locked = await withClientLock(clientId, () => teardownBody(clientId, deps, actor));
  if (locked === "busy") throw new Error("Another provisioning job is running for this client.");
}

async function teardownBody(clientId: string, deps: Phase3Deps, actor: Actor): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId } });
  if (!client || client.status === "churned") return;
  let run = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "teardown", status: { in: ["running", "failed"] } },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  if (!run) {
    run = await prisma.$transaction(async (tx) => {
      const created = await tx.provisioningRun.create({
        data: {
          clientId,
          kind: "teardown",
          status: "running",
          createdById: actor.id,
          steps: { create: TEARDOWN_STEPS.map((name) => ({ name, status: "pending" })) },
        },
        include: { steps: true },
      });
      await recordChange(tx, {
        clientId,
        actor,
        action: "churn.started",
        entityType: "provisioning_run",
        entityId: created.id,
        summary: `Started teardown for ${client.name}`,
      });
      return created;
    });
  }
  for (const name of TEARDOWN_STEPS) {
    const step = run.steps.find((item) => item.name === name);
    if (step?.status === "succeeded") continue;
    await markStep(run.id, name, { status: "running", error: null }, actor, clientId, `Running ${name}`);
    try {
      const fresh = await prisma.client.findFirstOrThrow({ where: { id: clientId } });
      let result: "deleted" | "missing" = "missing";
      if (name === "retell_number" && fresh.phoneE164) result = await deps.voice.deleteNumber(fresh.phoneE164);
      if (name === "retell_agent" && fresh.retellAgentId) result = await deps.voice.deleteAgent(fresh.retellAgentId);
      if (name === "retell_llm" && fresh.retellLlmId) result = await deps.voice.deleteLlm(fresh.retellLlmId);
      await markStep(run.id, name, { status: "succeeded", externalId: result, error: null }, actor, clientId, `Finished ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Teardown step failed";
      await markStep(run.id, name, { status: "failed", error: message }, actor, clientId, `Failed ${name}`);
      await prisma.provisioningRun.update({ where: { id: run.id }, data: { status: "failed" } });
      throw error;
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.provisioningRun.update({ where: { id: run.id }, data: { status: "succeeded", finishedAt: new Date() } });
    await tx.client.update({
      where: { id: clientId },
      data: {
        status: "churned",
        billingStatus: client.billingStatus === "none" ? "none" : "canceled",
        agentSyncStatus: "not_provisioned",
        phoneE164: null,
        retellAgentId: null,
        retellLlmId: null,
        stripeCheckoutUrl: null,
        stripeCheckoutExpiresAt: null,
        syncedConfigId: null,
      },
    });
    await recordChange(tx, {
      clientId,
      actor,
      action: "churn.completed",
      entityType: "client",
      entityId: clientId,
      summary: `Ended service for ${client.name}`,
      after: { status: "churned" },
    });
  });
}

export async function scheduleChurn(ctx: Actor, clientId: string, deps: Phase3Deps): Promise<void> {
  if (ctx.role !== "admin") throw new Error("Only an admin can end service.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  if (client.status === "churned") return;
  if (client.internal || !client.stripeSubscriptionId) throw new Error("This client has no paid period. End service now.");
  const { serviceEndsAt } = await deps.billing.cancelAtPeriodEnd(client.stripeSubscriptionId);
  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { billingStatus: "cancel_scheduled", serviceEndsAt },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "churn.scheduled",
      entityType: "client",
      entityId: clientId,
      summary: `Service for ${client.name} ends at the close of the paid period`,
      after: { serviceEndsAt: serviceEndsAt.toISOString() },
    });
  });
}

export async function endServiceNow(ctx: Actor, clientId: string, deps: Phase3Deps): Promise<void> {
  if (ctx.role !== "admin") throw new Error("Only an admin can end service.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client || client.status === "churned") return;
  if (client.stripeSubscriptionId) await deps.billing.cancelNow(client.stripeSubscriptionId);
  await teardown(clientId, deps, ctx);
}

const EARLIEST_SERVICE_END = new Date("2020-01-01T00:00:00.000Z");

export async function runDueTeardowns(
  deps: Phase3Deps,
  now = new Date(),
): Promise<{ completed: number; skipped: string[]; failed: Array<{ clientId: string; error: string }> }> {
  const due = await prisma.client.findMany({
    where: { billingStatus: "cancel_scheduled", serviceEndsAt: { lte: now }, status: { not: "churned" } },
    select: { id: true, serviceEndsAt: true, paidAt: true },
  });
  const skipped: string[] = [];
  const failed: Array<{ clientId: string; error: string }> = [];
  let completed = 0;
  for (const client of due) {
    if (!client.serviceEndsAt || client.serviceEndsAt < EARLIEST_SERVICE_END || (client.paidAt && client.serviceEndsAt < client.paidAt)) {
      skipped.push(client.id);
      continue;
    }
    try {
      await teardown(client.id, deps, WEBHOOK_ACTOR);
      completed += 1;
    } catch (error) {
      failed.push({ clientId: client.id, error: error instanceof Error ? error.message : "Teardown failed" });
    }
  }
  return { completed, skipped, failed };
}

function recipientsOf(features: unknown, internal: boolean, danielEmail: string | null): string[] {
  const text = features && typeof features === "object" && "messageRecipients" in features ? String((features as { messageRecipients?: unknown }).messageRecipients ?? "") : "";
  const emails = text.trim() ? parseRecipientEmails(text) : [];
  if (internal && danielEmail) emails.push(danielEmail.toLowerCase());
  return [...new Set(emails)];
}

export async function recordTakenMessage(
  clientId: string,
  args: { callerName?: string; callbackNumber?: string; message?: string },
  danielEmail: string | null,
  retellCallId: string | null = null,
): Promise<{ sentence: string; recipients: string[]; receivedAt: Date; timezone: string; messageId: string }> {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const body = (args.message ?? "").trim();
  if (!body) throw new Error("A message is required.");
  const recipients = recipientsOf(client.features, client.internal, danielEmail);
  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.clientMessage.create({
      data: {
        clientId,
        // Ciphertext and the masked callback only; the plaintext columns stay null (Phase S).
        ...messageData({
          callerName: plainCallerName(args.callerName ?? "Caller"),
          callbackNumber: (args.callbackNumber ?? "").trim().slice(0, 40),
          body: body.slice(0, 4000),
        }),
        retellCallId: retellCallId?.trim() ? retellCallId.trim().slice(0, 120) : null,
      },
    });
    await recordChange(tx, {
      clientId,
      actor: WEBHOOK_ACTOR,
      action: "message.stored",
      entityType: "client_message",
      entityId: row.id,
      summary: `Stored a message for ${client.name}`,
    });
    return row;
  });
  return { sentence: "I've passed that message to the office.", recipients, receivedAt: saved.createdAt, timezone: client.timezone, messageId: saved.id };
}

export type TransferDecision = { allowed: true; tool: string } | { allowed: false; reason: string };

export const TRANSFER_UNAVAILABLE = "I can't transfer this call. I'll take a message instead.";
export const TRANSFER_CLOSED = "The office can't take a transfer right now. Offer to take a message instead.";
export const TRANSFER_UNKNOWN_TARGET = "That person is not on the transfer list. Offer to take a message instead.";

/**
 * Resolves a transfer by label. `number` is accepted for one release for agents published before labels.
 * The result never contains a phone number.
 */
export async function decideTransfer(
  clientId: string,
  args: { target?: string | null; number?: string | null },
  now = new Date(),
): Promise<TransferDecision> {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client || !liveTransferOn(client.features)) return { allowed: false, reason: TRANSFER_UNAVAILABLE };
  const targets = await prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  const wanted = (args.target ?? "").trim().toLowerCase();
  let index = wanted ? targets.findIndex((target) => target.label.trim().toLowerCase() === wanted) : -1;
  if (index === -1 && args.number) {
    const normalized = normalizeTransferNumber(args.number);
    // Decrypt only for this legacy by-number lookup.
    if (normalized) index = targets.findIndex((target) => transferNumberOf(target) === normalized);
  }
  if (index === -1) return { allowed: false, reason: TRANSFER_UNKNOWN_TARGET };
  if (!officeOpen(client.weeklyHours, client.timezone, now)) return { allowed: false, reason: TRANSFER_CLOSED };
  const chosen = targets[index];
  if (!chosen || !transferNumberOf(chosen)) return { allowed: false, reason: TRANSFER_UNAVAILABLE };
  const names = transferToolNames(targets.map((target) => target.label));
  return { allowed: true, tool: names[index] ?? `transfer_${index + 1}` };
}

export type InboundDynamicVariables = { office_open: "yes" | "no"; allowed_targets: string };

export type InboundCallPayload = {
  dynamic_variables: InboundDynamicVariables;
  /** Per-call begin_message so open and closed openings stay one continuous utterance. */
  agent_override?: { retell_llm: { begin_message: string } };
};

function inboundPersona(voice: unknown): { assistantName: string; disclosureMode: "on_request" | "upfront" } {
  const row = voice && typeof voice === "object" && !Array.isArray(voice) ? (voice as Record<string, unknown>) : {};
  return {
    assistantName: typeof row.assistantName === "string" && row.assistantName.trim() ? row.assistantName.trim() : "Ava",
    disclosureMode: row.disclosureMode === "upfront" ? "upfront" : "on_request",
  };
}

function inboundRecordingOn(compliance: unknown): boolean {
  const row = compliance && typeof compliance === "object" && !Array.isArray(compliance) ? (compliance as Record<string, unknown>) : {};
  return row.recordingNotice !== false;
}

function inboundFeatures(features: unknown): PromptFeatures {
  const row = features && typeof features === "object" && !Array.isArray(features) ? (features as Record<string, unknown>) : {};
  const mode = row.bookingMode;
  return {
    bookingMode: mode === "request_only" || mode === "direct_calendar" ? mode : null,
    liveTransfer: row.liveTransfer === true,
    messages: typeof row.messages === "string" ? row.messages : typeof row.messageRecipients === "string" ? row.messageRecipients : null,
  };
}

/** Dynamic variables plus a begin_message override for the continuous open/closed greeting. */
export async function inboundCallPayload(toNumber: string, now = new Date()): Promise<InboundCallPayload> {
  const client = await prisma.client.findFirst({ where: { phoneE164: toNumber, archivedAt: null } });
  if (!client) return { dynamic_variables: { office_open: "no", allowed_targets: "" } };
  const targets = await prisma.transferTarget.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } });
  const open = officeOpen(client.weeklyHours, client.timezone, now);
  const persona = inboundPersona(client.voice);
  const features = inboundFeatures(client.features);
  const beginMessage = buildGreeting({
    businessName: client.name,
    assistantName: persona.assistantName,
    disclosureMode: persona.disclosureMode,
    recordingNotice: inboundRecordingOn(client.compliance),
    hoursState: open ? "open" : "closed",
    features,
  });
  return {
    dynamic_variables: {
      office_open: open ? "yes" : "no",
      allowed_targets: targets.map((target) => target.label.trim()).join("; "),
    },
    agent_override: { retell_llm: { begin_message: beginMessage } },
  };
}

export async function inboundVariables(toNumber: string, now = new Date()): Promise<InboundDynamicVariables> {
  return (await inboundCallPayload(toNumber, now)).dynamic_variables;
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

export type StripeApplyResult = { notify?: { subject: string; text: string } };

function stripeCustomerId(object: Record<string, unknown>): string {
  if (typeof object.customer === "string") return object.customer;
  if (object.customer && typeof object.customer === "object" && typeof (object.customer as { id?: unknown }).id === "string") {
    return (object.customer as { id: string }).id;
  }
  return "";
}

function unixDate(value: unknown, fallback: Date): Date {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1000);
}

export async function applyStripeEvent(event: StripeEvent, now = new Date()): Promise<StripeApplyResult> {
  const eventId = event.id ?? "";
  if (!eventId || !event.type) return {};
  const object = event.data?.object ?? {};
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as { client_id?: string }) : {};
  const clientId = metadata.client_id ?? (typeof object.client_reference_id === "string" ? object.client_reference_id : "");
  let notify: StripeApplyResult["notify"];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { eventId, type: event.type ?? "unknown" } });
      if (event.type === "checkout.session.completed" && clientId) {
        const paymentStatus = typeof object.payment_status === "string" ? object.payment_status : "";
        if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") return;
        const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
        const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
        if (!client || client.internal) return;
        const live = Boolean(client.phoneE164);
        await tx.client.update({
          where: { id: clientId },
          data: {
            billingStatus: "paid",
            paidAt: client.paidAt ?? now,
            stripeSubscriptionId: subscriptionId ?? client.stripeSubscriptionId,
            status: live ? "live" : client.status,
            liveAt: live ? client.liveAt ?? now : client.liveAt,
          },
        });
        await recordChange(tx, {
          clientId,
          actor: WEBHOOK_ACTOR,
          action: "billing.paid",
          entityType: "client",
          entityId: clientId,
          summary: `Payment received for ${client.name}`,
          after: { billingStatus: "paid" },
        });
      }
      if (event.type === "checkout.session.expired" && clientId) {
        await tx.client.updateMany({
          where: { id: clientId, billingStatus: "checkout_open" },
          data: { stripeCheckoutUrl: null, stripeCheckoutExpiresAt: null },
        });
      }
      if (event.type === "invoice.payment_failed") {
        const customer = stripeCustomerId(object);
        const client = customer
          ? await tx.client.findFirst({ where: { stripeCustomerId: customer, archivedAt: null, internal: false } })
          : null;
        if (!client) return;
        await tx.client.update({ where: { id: client.id }, data: { billingStatus: "past_due" } });
        await recordChange(tx, {
          clientId: client.id,
          actor: WEBHOOK_ACTOR,
          action: "billing.past_due",
          entityType: "client",
          entityId: client.id,
          summary: `A payment failed for ${client.name}`,
          after: { billingStatus: "past_due" },
        });
        notify = {
          subject: `Payment failed for ${client.name}`,
          text: `Stripe reported a failed invoice for ${client.name}. The client is past due.`,
        };
      }
      if (event.type === "customer.subscription.deleted") {
        const subscriptionId = typeof object.id === "string" ? object.id : "";
        if (!subscriptionId) return;
        const client = await tx.client.findFirst({ where: { stripeSubscriptionId: subscriptionId, archivedAt: null } });
        if (!client || client.status === "churned") return;
        const serviceEndsAt = unixDate(object.ended_at, now);
        await tx.client.update({
          where: { id: client.id },
          data: { billingStatus: "cancel_scheduled", serviceEndsAt },
        });
        await recordChange(tx, {
          clientId: client.id,
          actor: WEBHOOK_ACTOR,
          action: "billing.subscription_deleted",
          entityType: "client",
          entityId: client.id,
          summary: `Stripe canceled the subscription for ${client.name}`,
          after: { billingStatus: "cancel_scheduled", serviceEndsAt: serviceEndsAt.toISOString() },
        });
        notify = {
          subject: `Subscription canceled for ${client.name}`,
          text: `Stripe canceled the subscription for ${client.name}. Service is scheduled to stop.`,
        };
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return {};
    throw error;
  }
  return notify ? { notify } : {};
}

export function formatTargetsFor(rows: Array<{ label: string; e164: string }>): string {
  return formatTransferTargets(rows);
}

export function weeklyHoursOf(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object") return null;
  return value as WeeklyHours;
}

export { overageLookupKey };
