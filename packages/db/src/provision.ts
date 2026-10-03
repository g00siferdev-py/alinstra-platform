import type { BillingPlatform, PublishedTool, VoicePlatform } from "@alinstra/providers";
import { overageLookupKey, TAKE_MESSAGE_PARAMETERS, TRANSFER_CHECK_PARAMETERS } from "@alinstra/providers";
import { Pool } from "pg";
import { Prisma } from "./generated/prisma/client";
import { recordChange, type Actor } from "./changes";
import { prisma } from "./client";
import {
  assertTransferNumber,
  clientIsHealthcare,
  formatTransferTargets,
  maskCaller,
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

const PROVISION_STEPS = ["stripe_customer", "stripe_checkout", "retell_llm", "retell_agent", "retell_number", "retell_bind"] as const;
const TEARDOWN_STEPS = ["retell_number", "retell_agent", "retell_llm"] as const;

const WEBHOOK_ACTOR: Actor = { id: "provider-webhook", role: "admin" };

export type Phase3Deps = {
  voice: VoicePlatform;
  billing: BillingPlatform;
  appUrl: string;
  voiceId: string;
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
      return prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
    },
  };
}

export function clientMessages(ctx: TenantContext) {
  return {
    list(clientId: string) {
      if (!owns(ctx, clientId)) return Promise.resolve([]);
      return prisma.clientMessage.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 50 });
    },
  };
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
    await tx.transferTarget.createMany({ data: rows.map((row) => ({ clientId, label: row.label, e164: row.e164 })) });
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
  if (!liveTransferOn(features) || targets.length === 0) return tools;
  const allowed = targets.map((target) => `${target.label} ${target.e164}`).join("; ");
  tools.push({
    name: "transfer",
    description: `Ask before transferring. Call this with number set to one of these targets only: ${allowed}. If this tool says the office is closed, take a message.`,
    url: `${base}/api/retell/tools/transfer`,
    timeoutMs: 8000,
    parameters: TRANSFER_CHECK_PARAMETERS,
  });
  for (const target of targets) {
    tools.push({
      name: `transfer_${target.e164.replace(/\D/g, "")}`,
      description: `Cold transfer to ${target.label} (${target.e164}) only after the transfer tool allows it and only during business hours.`,
      transferTo: target.e164,
    });
  }
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

export async function createClientZero(ctx: Actor): Promise<{ id: string; created: boolean }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can create client zero.");
  const existing = await prisma.client.findFirst({ where: { internal: true, archivedAt: null }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { name: "Alinstra", internal: true, status: "lead", phone: { tollFree: true } } });
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

export async function startProvisioning(ctx: Actor, clientId: string): Promise<{ runId: string }> {
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
  if (existing) return { runId: existing.id };
  try {
  return await prisma.$transaction(async (tx) => {
    const run = await tx.provisioningRun.create({
      data: {
        clientId,
        kind: "provision",
        status: "running",
        createdById: ctx.id,
        steps: { create: PROVISION_STEPS.map((name) => ({ name, status: "pending" })) },
      },
    });
    await recordChange(tx, {
      clientId,
      actor: ctx,
      action: "provision.started",
      entityType: "provisioning_run",
      entityId: run.id,
      summary: `Started provisioning for ${client.name}`,
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
  await prisma.transferTarget.create({ data: { clientId, label: "Daniel", e164: number } });
}

async function publishInput(clientId: string, deps: Phase3Deps) {
  const loaded = await loadReady(clientId);
  if (!loaded.config) throw new Error("Activate a receptionist config before provisioning.");
  if (!deps.voiceId) throw new Error("Set RETELL_DEFAULT_VOICE_ID after a voice is chosen. See docs/voice-options.md.");
  if (loaded.client.internal) await ensureDanielTarget(clientId, deps.danielNumber);
  const targets = await prisma.transferTarget.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  const base = origin(deps.appUrl);
  return {
    loaded,
    targets,
    prompt: retellPrompt(loaded.config.promptText, loaded.client.timezone),
    beginMessage: loaded.config.greeting?.trim() || "Thank you for calling.",
    tools: toolsFor(deps.appUrl, targets, loaded.client.features),
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
      voiceId: deps.voiceId,
      webhookUrl: published.webhookUrl,
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
    await prisma.client.update({ where: { id: clientId }, data: { phoneE164: e164 } });
    return e164;
  }
  if (!client.retellLlmId || !client.retellAgentId) throw new Error("Create the Retell agent before binding it.");
  await deps.voice.syncAgent({
    clientId,
    llmId: client.retellLlmId,
    agentId: client.retellAgentId,
    prompt: published.prompt,
    beginMessage: published.beginMessage,
    voiceId: deps.voiceId,
    tools: published.tools,
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
      voiceId: deps.voiceId,
      tools: published.tools,
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
): Promise<{ sentence: string; recipients: string[] }> {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const body = (args.message ?? "").trim();
  if (!body) throw new Error("A message is required.");
  const recipients = recipientsOf(client.features, client.internal, danielEmail);
  await prisma.$transaction(async (tx) => {
    const row = await tx.clientMessage.create({
      data: {
        clientId,
        callerName: plainCallerName(args.callerName ?? "Caller"),
        callbackNumber: (args.callbackNumber ?? "").trim().slice(0, 40),
        body: body.slice(0, 4000),
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
  });
  return { sentence: "I've passed that message to the office.", recipients };
}

export async function decideTransfer(clientId: string, number: string, now = new Date()): Promise<string> {
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) return "I can't transfer this call. I'll take a message instead.";
  const targets = await prisma.transferTarget.findMany({ where: { clientId } });
  const normalized = normalizeTransferNumber(number);
  const allowed = normalized !== null && targets.some((target) => target.e164 === normalized);
  if (!allowed || !officeOpen(client.weeklyHours, client.timezone, now)) {
    return "The office can't take a transfer right now. Offer to take a message instead.";
  }
  return `Transfer is allowed to ${normalized}.`;
}

export async function inboundVariables(toNumber: string, now = new Date()): Promise<{ office_open: "yes" | "no"; allowed_numbers: string }> {
  const client = await prisma.client.findFirst({ where: { phoneE164: toNumber, archivedAt: null } });
  if (!client) return { office_open: "no", allowed_numbers: "" };
  const targets = await prisma.transferTarget.findMany({ where: { clientId: client.id } });
  return {
    office_open: officeOpen(client.weeklyHours, client.timezone, now) ? "yes" : "no",
    allowed_numbers: targets.map((target) => target.e164).join(", "),
  };
}

type CallPayload = {
  event?: string;
  call?: {
    call_id?: string;
    agent_id?: string;
    from_number?: string;
    to_number?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    disconnection_reason?: string;
  };
};

export async function applyRetellCall(payload: CallPayload): Promise<void> {
  const call = payload.call;
  if (!call?.call_id) return;
  if (payload.event !== "call_started" && payload.event !== "call_ended") return;
  const client = await prisma.client.findFirst({
    where: {
      archivedAt: null,
      OR: [
        ...(call.agent_id ? [{ retellAgentId: call.agent_id }] : []),
        ...(call.to_number ? [{ phoneE164: call.to_number }] : []),
      ],
    },
  });
  if (!client) return;
  const startedAt = typeof call.start_timestamp === "number" ? new Date(call.start_timestamp) : null;
  const endedAt = typeof call.end_timestamp === "number" ? new Date(call.end_timestamp) : null;
  const durationSeconds = startedAt && endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.callRecord.findUnique({ where: { retellCallId: call.call_id! } });
    if (!existing) {
      const created = await tx.callRecord.create({
        data: {
          clientId: client.id,
          retellCallId: call.call_id!,
          startedAt,
          endedAt: payload.event === "call_ended" ? endedAt : null,
          durationSeconds: payload.event === "call_ended" ? durationSeconds : null,
          callerMasked: maskCaller(call.from_number ?? ""),
          endReason: payload.event === "call_ended" ? call.disconnection_reason ?? null : null,
        },
      });
      await recordChange(tx, {
        clientId: client.id,
        actor: WEBHOOK_ACTOR,
        action: "call.recorded",
        entityType: "call_record",
        entityId: created.id,
        summary: `Recorded a call for ${client.name}`,
      });
      return;
    }
    if (payload.event !== "call_ended") return;
    await tx.callRecord.update({
      where: { id: existing.id },
      data: {
        startedAt: existing.startedAt ?? startedAt,
        endedAt,
        durationSeconds,
        endReason: call.disconnection_reason ?? existing.endReason,
        callerMasked: existing.callerMasked || maskCaller(call.from_number ?? ""),
      },
    });
  });
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
