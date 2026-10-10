import type { TextPlatform } from "@alinstra/providers";
import type { Prisma } from "./generated/prisma/client";
import { activateAgentConfig } from "./agent";
import { getAppSetting, setAppSetting } from "./app-settings";
import { recordChange, type Actor } from "./changes";
import { prisma } from "./client";
import { clientIsHealthcare } from "./domain";
import { avaLiveWelcomeText, OWNER_HELD_MESSAGE } from "./go-live-copy";
import { advanceProvisioning, startProvisioning, type Phase3Deps } from "./provision";

export const AUTO_GO_LIVE_SETTING_KEY = "autoGoLive";
export const SYSTEM_GO_LIVE_ACTOR: Actor = { id: "system:auto-go-live", role: "admin" };

export type GoLiveCheckId = "setting" | "paid" | "eligible" | "verified" | "complete" | "content" | "cap" | "duplicate" | "provisioning";

export type GoLiveCheck = {
  id: GoLiveCheckId;
  label: string;
  pass: boolean;
  reason: string | null;
};

export type GoLiveReview = {
  outcome: "pass" | "held";
  checks: GoLiveCheck[];
  at: string;
};

export type AutoGoLiveDeps = {
  text: Pick<TextPlatform, "complete">;
  provision: Phase3Deps;
  now?: Date;
  adminEmail: string;
  appUrl: string;
  tollFree: string | null;
  dailyCap?: number;
  allowTest?: boolean;
  sleep?: (ms: number) => Promise<void>;
  send: (message: { to: string; subject: string; text: string }) => Promise<void>;
  notifyProvisionFailure?: (clientId: string) => Promise<void>;
};

const CONTENT_SYSTEM = `You screen a small-business phone receptionist setup. Reply with one JSON object {"ok": boolean, "reason": string}.
Set ok to false when the business is human healthcare or needs patient health information; debt collection or bail bonds; adult content; gambling; cannabis or firearms sales; political campaigns; telemarketing or lead resale; when the setup asks Ava to collect card numbers, bank details, or Social Security numbers; or anything plainly illegal. Otherwise set ok to true and reason to an empty string.`;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function hoursPresent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
}

function parseScreen(text: string): { ok: boolean; reason: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as { ok?: unknown; reason?: unknown };
    if (typeof value.ok !== "boolean") return null;
    return { ok: value.ok, reason: typeof value.reason === "string" ? value.reason.slice(0, 500) : "" };
  } catch {
    return null;
  }
}

export function readGoLiveReview(value: unknown): GoLiveReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as { outcome?: unknown; checks?: unknown; at?: unknown };
  if (row.outcome !== "pass" && row.outcome !== "held") return null;
  if (!Array.isArray(row.checks)) return null;
  return value as GoLiveReview;
}

export async function autoGoLiveEnabled(): Promise<boolean> {
  const value = await getAppSetting(AUTO_GO_LIVE_SETTING_KEY);
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as { enabled?: unknown }).enabled === true;
  }
  return false;
}

export async function setAutoGoLive(ctx: Actor, enabled: boolean) {
  return setAppSetting(ctx, AUTO_GO_LIVE_SETTING_KEY, { enabled });
}

export async function shouldEnqueueAutoGoLive(clientId: string): Promise<boolean> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, archivedAt: null },
    select: { selfServe: true, billingStatus: true, wizardSubmittedAt: true, internal: true, status: true },
  });
  return Boolean(
    client &&
      client.selfServe &&
      !client.internal &&
      client.billingStatus === "paid" &&
      client.wizardSubmittedAt &&
      client.status !== "live" &&
      client.status !== "churned",
  );
}

async function screenContent(
  text: Pick<TextPlatform, "complete">,
  facts: { name: string; notes: string; services: string; faqs: string },
): Promise<GoLiveCheck> {
  try {
    const result = await text.complete({
      system: CONTENT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Business: ${facts.name}\nNotes: ${facts.notes}\nServices: ${facts.services}\nFAQs: ${facts.faqs}`,
        },
      ],
      maxTokens: 200,
      json: true,
    });
    const parsed = parseScreen(result.text);
    if (!parsed) return { id: "content", label: "Content", pass: false, reason: "content check unavailable" };
    if (!parsed.ok) return { id: "content", label: "Content", pass: false, reason: parsed.reason || "content check held" };
    return { id: "content", label: "Content", pass: true, reason: null };
  } catch {
    return { id: "content", label: "Content", pass: false, reason: "content check unavailable" };
  }
}

export async function evaluateAutoGoLive(
  clientId: string,
  deps: Pick<AutoGoLiveDeps, "text" | "now" | "dailyCap" | "allowTest">,
  options: { skip?: GoLiveCheckId[] } = {},
): Promise<GoLiveCheck[]> {
  const skip = new Set(options.skip ?? []);
  const now = deps.now ?? new Date();
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const [owner, knowledge, targets, recent] = await Promise.all([
    prisma.user.findFirst({
      where: { clientId, role: "client_owner" },
      select: { emailVerified: true, email: true },
    }),
    prisma.knowledgeBase.findFirst({
      where: { clientId },
      orderBy: { version: "desc" },
      select: { services: true, faqs: true, hours: true },
    }),
    prisma.transferTarget.count({ where: { clientId } }),
    prisma.client.count({
      where: { id: { not: clientId }, autoGoLiveAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  const duplicateFilters: Array<{ portalOwnerEmail: string } | { contactPhone: string }> = [];
  if (client.portalOwnerEmail) duplicateFilters.push({ portalOwnerEmail: client.portalOwnerEmail });
  if (owner?.email && owner.email !== client.portalOwnerEmail) duplicateFilters.push({ portalOwnerEmail: owner.email });
  if (client.contactPhone) duplicateFilters.push({ contactPhone: client.contactPhone });
  const duplicates = duplicateFilters.length
    ? await prisma.client.findFirst({
        where: { id: { not: clientId }, archivedAt: null, status: { not: "churned" }, OR: duplicateFilters },
        select: { id: true },
      })
    : null;

  const checks: GoLiveCheck[] = [];
  const push = (check: GoLiveCheck) => checks.push(check);
  const skipped = (id: GoLiveCheckId) => skip.has(id);

  push(
    skipped("setting")
      ? { id: "setting", label: "Auto go-live", pass: true, reason: null }
      : (await autoGoLiveEnabled())
        ? { id: "setting", label: "Auto go-live", pass: true, reason: null }
        : { id: "setting", label: "Auto go-live", pass: false, reason: "auto go-live is off" },
  );

  const liveModeOk = client.stripeLivemode === true || (client.stripeLivemode === false && deps.allowTest === true);
  let paidReason: string | null = null;
  if (client.billingStatus !== "paid" || !client.stripeSubscriptionId) paidReason = "subscription is not active";
  else if (client.stripeLivemode === false && !deps.allowTest) paidReason = "test-mode payment";
  else if (!liveModeOk) paidReason = "payment was not in live mode";
  push(
    skipped("paid")
      ? { id: "paid", label: "Paid", pass: true, reason: null }
      : { id: "paid", label: "Paid", pass: paidReason === null, reason: paidReason },
  );

  let eligibleReason: string | null = null;
  if (client.internal) eligibleReason = "internal client";
  else if (client.status === "churned") eligibleReason = "churned";
  else if (clientIsHealthcare(client)) eligibleReason = "healthcare";
  push(
    skipped("eligible")
      ? { id: "eligible", label: "Eligible", pass: true, reason: null }
      : { id: "eligible", label: "Eligible", pass: eligibleReason === null, reason: eligibleReason },
  );

  push(
    skipped("verified")
      ? { id: "verified", label: "Email", pass: true, reason: null }
      : owner?.emailVerified
        ? { id: "verified", label: "Email", pass: true, reason: null }
        : { id: "verified", label: "Email", pass: false, reason: "owner email is not verified" },
  );

  const features = client.features && typeof client.features === "object" ? (client.features as { liveTransfer?: boolean }) : {};
  const services = textOf(knowledge?.services);
  const faqs = textOf(knowledge?.faqs);
  let completeReason: string | null = null;
  if (!client.name.trim()) completeReason = "business name is missing";
  else if (!client.timezone.trim()) completeReason = "timezone is missing";
  else if (!hoursPresent(client.weeklyHours) && !hoursPresent(knowledge?.hours)) completeReason = "hours are missing";
  else if (!services && !faqs) completeReason = "services or FAQs are missing";
  else if (features.liveTransfer === true && targets === 0) completeReason = "live transfer needs a transfer target";
  push(
    skipped("complete")
      ? { id: "complete", label: "Complete", pass: true, reason: null }
      : { id: "complete", label: "Complete", pass: completeReason === null, reason: completeReason },
  );

  const structuralFailed = checks.some((check) => !check.pass);
  if (skipped("content")) {
    push({ id: "content", label: "Content", pass: true, reason: null });
  } else if (!structuralFailed) {
    push(
      await screenContent(deps.text, {
        name: client.name,
        notes: textOf(client.notes),
        services,
        faqs,
      }),
    );
  }

  const cap = deps.dailyCap ?? 15;
  push(
    skipped("cap")
      ? { id: "cap", label: "Daily cap", pass: true, reason: null }
      : recent < cap
        ? { id: "cap", label: "Daily cap", pass: true, reason: null }
        : { id: "cap", label: "Daily cap", pass: false, reason: "daily cap reached" },
  );

  push(
    skipped("duplicate")
      ? { id: "duplicate", label: "Duplicate", pass: true, reason: null }
      : duplicates
        ? { id: "duplicate", label: "Duplicate", pass: false, reason: "another client uses this owner email or mobile number" }
        : { id: "duplicate", label: "Duplicate", pass: true, reason: null },
  );

  return checks;
}

async function saveReview(clientId: string, outcome: "pass" | "held", checks: GoLiveCheck[], now: Date, status?: string) {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(status ? { status } : {}),
      ...(outcome === "pass" ? { autoGoLiveAt: now, status: "live", liveAt: now } : {}),
      goLiveReview: json({ outcome, checks, at: now.toISOString() } satisfies GoLiveReview),
    },
  });
}

async function emailHold(deps: AutoGoLiveDeps, client: { id: string; name: string; portalOwnerEmail: string | null }, checks: GoLiveCheck[]) {
  const reasons = checks.filter((check) => !check.pass).map((check) => check.reason).filter(Boolean);
  const link = `${deps.appUrl.replace(/\/$/, "")}/admin/clients/${client.id}`;
  if (client.portalOwnerEmail) {
    await deps.send({ to: client.portalOwnerEmail, subject: "We're checking your Ava setup", text: OWNER_HELD_MESSAGE });
  }
  if (deps.adminEmail) {
    await deps.send({
      to: deps.adminEmail,
      subject: `${client.name} is held for review`,
      text: [`${client.name} is held for review.`, "", ...reasons.map((reason) => `- ${reason}`), "", link].join("\n"),
    });
  }
}

async function emailLive(deps: AutoGoLiveDeps, client: { id: string; name: string; portalOwnerEmail: string | null; phoneE164: string | null }, checks: GoLiveCheck[]) {
  const link = `${deps.appUrl.replace(/\/$/, "")}/admin/clients/${client.id}`;
  const phone = client.phoneE164 ?? "";
  if (client.portalOwnerEmail && phone) {
    await deps.send({
      to: client.portalOwnerEmail,
      subject: "Ava is live",
      text: avaLiveWelcomeText({ businessName: client.name, phone, tollFree: deps.tollFree }),
    });
  }
  if (deps.adminEmail) {
    const lines = checks.map((check) => `${check.pass ? "pass" : "hold"} ${check.label}${check.reason ? `: ${check.reason}` : ""}`);
    await deps.send({
      to: deps.adminEmail,
      subject: `${client.name} went live automatically`,
      text: [`${client.name} went live automatically.`, `Number: ${phone || "unknown"}`, "", ...lines, "", link].join("\n"),
    });
  }
}

async function provisionLive(clientId: string, deps: AutoGoLiveDeps, actor: Actor): Promise<"live" | "held"> {
  const draft = await prisma.agentConfig.findFirst({
    where: { clientId, status: "draft" },
    orderBy: { version: "desc" },
  });
  const active = await prisma.agentConfig.findFirst({ where: { clientId, status: "active" } });
  if (draft && !active) await activateAgentConfig(actor, { clientId, version: draft.version });
  const succeeded = await prisma.provisioningRun.findFirst({
    where: { clientId, kind: "provision", status: "succeeded" },
  });
  if (!succeeded) {
    await startProvisioning(actor, clientId, { numberApproved: true });
    const sleep = deps.sleep ?? (async () => undefined);
    let status = "running";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        status = (await advanceProvisioning(actor, clientId, deps.provision)).status;
      } catch (error) {
        status = "failed";
        if (attempt === 3) throw error;
      }
      if (status === "succeeded") break;
      if (attempt < 3) await sleep(attempt * 250);
    }
    if (status !== "succeeded") return "held";
  }
  return "live";
}

export async function runAutoGoLive(clientId: string, deps: AutoGoLiveDeps): Promise<{ outcome: "live" | "held" | "already_live"; checks: GoLiveCheck[] }> {
  const now = deps.now ?? new Date();
  const existing = await prisma.client.findFirst({ where: { id: clientId } });
  if (!existing) throw new Error("That client is not available.");
  if (existing.status === "live" && existing.phoneE164) {
    return { outcome: "already_live", checks: readGoLiveReview(existing.goLiveReview)?.checks ?? [] };
  }
  const checks = await evaluateAutoGoLive(clientId, deps);
  if (checks.some((check) => !check.pass)) {
    await saveReview(clientId, "held", checks, now, "held_for_review");
    await prisma.$transaction(async (tx) => recordChange(tx, {
      clientId,
      actor: SYSTEM_GO_LIVE_ACTOR,
      action: "auto_go_live.held",
      entityType: "client",
      entityId: clientId,
      summary: `Held ${existing.name} for review`,
      after: json({ reasons: checks.filter((check) => !check.pass).map((check) => check.reason) }),
    }));
    await emailHold(deps, existing, checks);
    return { outcome: "held", checks };
  }
  const provisioned = await provisionLive(clientId, deps, SYSTEM_GO_LIVE_ACTOR).catch(async () => "held" as const);
  if (provisioned === "held") {
    const failed = [...checks, { id: "provisioning" as const, label: "Provisioning", pass: false, reason: "provisioning failed" }];
    await saveReview(clientId, "held", failed, now, "held_for_review");
    await deps.notifyProvisionFailure?.(clientId);
    await emailHold(deps, existing, failed);
    return { outcome: "held", checks: failed };
  }
  const fresh = await prisma.client.findFirstOrThrow({ where: { id: clientId } });
  await saveReview(clientId, "pass", checks, now);
  await prisma.$transaction((tx) => recordChange(tx, {
    clientId,
    actor: SYSTEM_GO_LIVE_ACTOR,
    action: "auto_go_live.passed",
    entityType: "client",
    entityId: clientId,
    summary: `${fresh.name} went live automatically`,
    after: json({ phone: fresh.phoneE164 }),
  }));
  await emailLive(deps, fresh, checks);
  return { outcome: "live", checks };
}

export async function approveAutoGoLive(ctx: Actor, clientId: string, deps: AutoGoLiveDeps): Promise<{ outcome: "live" | "held" }> {
  if (ctx.role !== "admin") throw new Error("Only an admin can approve go-live.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  const previous = readGoLiveReview(client.goLiveReview);
  const skip = (previous?.checks ?? []).filter((check) => !check.pass && check.id !== "provisioning").map((check) => check.id);
  if (!skip.includes("cap")) skip.push("cap");
  const checks = await evaluateAutoGoLive(clientId, deps, { skip });
  const now = deps.now ?? new Date();
  await prisma.$transaction((tx) => recordChange(tx, {
    clientId,
    actor: ctx,
    action: "auto_go_live.approved",
    entityType: "client",
    entityId: clientId,
    summary: `Approved go-live for ${client.name}`,
  }));
  if (checks.some((check) => !check.pass)) {
    await saveReview(clientId, "held", checks, now, "held_for_review");
    return { outcome: "held" };
  }
  const provisioned = await provisionLive(clientId, deps, SYSTEM_GO_LIVE_ACTOR);
  if (provisioned === "held") {
    await saveReview(clientId, "held", checks, now, "held_for_review");
    return { outcome: "held" };
  }
  await saveReview(clientId, "pass", checks, now);
  const fresh = await prisma.client.findFirstOrThrow({ where: { id: clientId } });
  await emailLive(deps, fresh, checks);
  return { outcome: "live" };
}

export async function declineAutoGoLive(ctx: Actor, clientId: string): Promise<void> {
  if (ctx.role !== "admin") throw new Error("Only an admin can decline go-live.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  await prisma.$transaction((tx) => recordChange(tx, {
    clientId,
    actor: ctx,
    action: "auto_go_live.declined",
    entityType: "client",
    entityId: clientId,
    summary: `Declined automatic go-live for ${client.name}`,
  }));
}

export async function pauseClientByAdmin(ctx: Actor, clientId: string): Promise<void> {
  if (ctx.role !== "admin") throw new Error("Only an admin can pause a client.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null, status: "live" } });
  if (!client) throw new Error("Only a live client can be paused.");
  const now = new Date();
  await prisma.client.update({ where: { id: clientId }, data: { adminPausedAt: client.adminPausedAt ?? now } });
  await prisma.$transaction((tx) => recordChange(tx, {
    clientId,
    actor: ctx,
    action: "client.paused",
    entityType: "client",
    entityId: clientId,
    summary: `Paused Ava for ${client.name}`,
    after: { reason: "paused by admin" },
  }));
}

export async function resumeClientByAdmin(ctx: Actor, clientId: string): Promise<void> {
  if (ctx.role !== "admin") throw new Error("Only an admin can resume a client.");
  const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null } });
  if (!client) throw new Error("That client is not available.");
  await prisma.client.update({ where: { id: clientId }, data: { adminPausedAt: null } });
  await prisma.$transaction((tx) => recordChange(tx, {
    clientId,
    actor: ctx,
    action: "client.resumed",
    entityType: "client",
    entityId: clientId,
    summary: `Resumed Ava for ${client.name}`,
  }));
}
