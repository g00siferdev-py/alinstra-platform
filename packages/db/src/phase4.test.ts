import { PRIVACY_RULE, TEMPLATE_VERSION } from "@alinstra/agent";
import { CALL_TIMING_DEFAULTS, END_CALL_TOOL, MemoryBilling, MemoryVoice } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { businessSchema, callTimingOf, coverageSchema } from "./domain";
import { diffSection } from "./edit-diff";
import { clientEditPayload, editClientStep } from "./wizard";
import {
  advanceProvisioning,
  approveNumberPurchase,
  AWAITING_NUMBER_APPROVAL,
  createClientZero,
  decideTransfer,
  inboundVariables,
  latestProvisionFailure,
  numberPurchaseFor,
  replaceTransferTargets,
  startProvisioning,
  syncProvisionedAgent,
  type Phase3Deps,
} from "./provision";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_phase4", role: "admin" as const };
const openFriday = new Date("2026-10-02T19:00:00.000Z");

const TARGETS = [
  { label: "Front desk", e164: "+14155550100" },
  { label: "Dr. Patel", e164: "+14155550123" },
  { label: "Billing", e164: "+14155550177" },
];

async function seedClient(options: { internal?: boolean; name?: string; publicPhone?: string | null } = {}) {
  const plan = await prisma.plan.create({
    data: {
      code: `plan_${(options.name ?? "west").toLowerCase()}`,
      name: "Starter",
      monthlyPriceCents: 10000,
      includedMinutes: 100,
      overagePerMinuteCents: 40,
      setupFeeCents: 5000,
      extraChangeFeeCents: 4900,
      recallMonthlyCents: 0,
      recallPerBookingCents: 0,
      sortOrder: 1,
    },
  });
  const client = await prisma.client.create({
    data: {
      name: options.name ?? "West Dental Lab",
      status: "lead",
      industry: "hvac",
      timezone: "America/New_York",
      wizardSubmittedAt: new Date(),
      planId: plan.id,
      internal: options.internal ?? false,
      contactEmail: "owner@example.com",
      contactPhone: "+14155550999",
      publicPhone: options.publicPhone ?? null,
      weeklyHours: { fri: { start: "09:00", end: "17:00" } },
      compliance: { healthcareSensitive: false, healthcareTouched: true },
      features: { messageRecipients: "office@example.com", liveTransfer: true },
    },
  });
  await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "submitted", staff: "Owner: Dana Lee" } });
  await prisma.agentConfig.create({
    data: {
      clientId: client.id,
      version: 1,
      status: "active",
      promptText: "Old template. The owner's cell is +14155550999.",
      templateId: "general",
      templateVersion: "3",
      documentIds: [],
      tools: [],
      settings: {},
      greeting: "Thanks for calling.",
      source: "test",
      createdById: admin.id,
    },
  });
  for (const target of TARGETS) {
    await prisma.transferTarget.create({ data: { clientId: client.id, ...target } });
  }
  return client;
}

function deps(voice: MemoryVoice, billing: MemoryBilling): Phase3Deps {
  return {
    voice,
    billing,
    appUrl: "https://staging.alinstra.com",
    danielNumber: "+14155550199",
    danielEmail: "daniel@alinstra.com",
    defaultAreaCode: "423",
    defaultTollFree: false,
  };
}

function textOf(tools: Array<{ name: string; description: string }>): string {
  return tools.map((tool) => `${tool.name} ${tool.description}`).join("\n");
}

describe("phase 4 privacy", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("publishes transfer tools by label with no phone number in any name or description", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    await startProvisioning(admin, client.id, { numberApproved: true });
    await advanceProvisioning(admin, client.id, deps(voice, new MemoryBilling()));
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    const llm = voice.llms.get(stored.retellLlmId ?? "");
    expect(llm).toBeTruthy();
    const tools = llm?.tools ?? [];
    const text = textOf(tools);
    expect(text).not.toContain("+1");
    expect(text).not.toMatch(/\d{10,}/);
    for (const target of TARGETS) {
      expect(text).not.toContain(target.e164);
      expect(text).not.toContain(target.e164.slice(1));
    }
    expect(tools.map((tool) => tool.name)).toEqual(["take_message", "transfer", "transfer_front_desk", "transfer_dr_patel", "transfer_billing", "end_call"]);
    expect(tools.find((tool) => tool.name === "transfer")?.description).toContain("Front desk; Dr. Patel; Billing");
    expect(tools.find((tool) => tool.name === "transfer")?.parameters?.required).toEqual(["target"]);
    expect(tools.find((tool) => tool.name === "transfer_dr_patel")?.transferTo).toBe("+14155550123");
    expect(JSON.stringify(tools.find((tool) => tool.name === "transfer")?.parameters)).not.toContain("number");
  });

  it("resolves a transfer by label, rejects unknown labels, and never echoes a number", async () => {
    const client = await seedClient();
    const allowed = await decideTransfer(client.id, { target: "dr. patel" }, openFriday);
    expect(allowed).toEqual({ allowed: true, tool: "transfer_dr_patel" });
    const unknown = await decideTransfer(client.id, { target: "Dr. Nobody" }, openFriday);
    expect(unknown).toMatchObject({ allowed: false });
    const legacy = await decideTransfer(client.id, { number: "(415) 555-0177" }, openFriday);
    expect(legacy).toEqual({ allowed: true, tool: "transfer_billing" });
    for (const decision of [allowed, unknown, legacy]) {
      expect(JSON.stringify(decision)).not.toMatch(/\d{7,}/);
    }
    await prisma.client.update({ where: { id: client.id }, data: { features: { liveTransfer: false } } });
    expect(await decideTransfer(client.id, { target: "Billing" }, openFriday)).toMatchObject({ allowed: false });
  });

  it("sends target labels, never numbers, as inbound dynamic variables", async () => {
    const client = await seedClient();
    await prisma.client.update({ where: { id: client.id }, data: { phoneE164: "+18005550100" } });
    const variables = await inboundVariables("+18005550100", openFriday);
    expect(variables).toEqual({ office_open: "yes", allowed_targets: "Front desk; Dr. Patel; Billing" });
    expect(JSON.stringify(variables)).not.toMatch(/\d{4,}/);
    expect(await inboundVariables("+18005550199", openFriday)).toEqual({ office_open: "no", allowed_targets: "" });
  });

  it("rebuilds an old-template config on sync and republishes the tools and the public phone", async () => {
    const client = await seedClient({ internal: true, name: "Alinstra" });
    const voice = new MemoryVoice();
    const used = deps(voice, new MemoryBilling());
    await startProvisioning(admin, client.id, { numberApproved: true });
    await advanceProvisioning(admin, client.id, used);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    const active = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id, status: "active" } });
    expect(active.templateVersion).toBe(TEMPLATE_VERSION);
    expect(active.source).toBe("template_refresh");
    const llm = voice.llms.get(stored.retellLlmId ?? "");
    expect(llm?.prompt).toContain(PRIVACY_RULE);
    expect(llm?.prompt).not.toContain("+14155550999");
    expect(stored.publicPhone).toBe(stored.phoneE164);
    expect(llm?.prompt.split(stored.phoneE164 ?? "none")).toHaveLength(2);

    await replaceTransferTargets(admin, { clientId: client.id, text: "Owner line, +14155550188" });
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    const names = (voice.llms.get(stored.retellLlmId ?? "")?.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(["take_message", "transfer", "transfer_owner_line", "end_call"]);
    expect(textOf(voice.llms.get(stored.retellLlmId ?? "")?.tools ?? [])).not.toContain("0188");

    await prisma.client.update({ where: { id: client.id }, data: { publicPhone: "+18883871525", agentSyncStatus: "syncing", syncedConfigId: null } });
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    const refreshed = voice.llms.get(stored.retellLlmId ?? "")?.prompt ?? "";
    expect(refreshed.split("+18883871525")).toHaveLength(2);
    expect(refreshed).not.toContain(stored.phoneE164 ?? "none");
  });

  it("edits a live client step by step: new config, redacted change log, sync only when Ava is affected", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    await startProvisioning(admin, client.id, { numberApproved: true });
    await advanceProvisioning(admin, client.id, deps(voice, new MemoryBilling()));
    const before = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id, status: "active" } });
    const base = await clientEditPayload(admin, client.id);

    const coverage = await editClientStep(admin, {
      clientId: client.id,
      step: 4,
      payload: { ...base, coverage: { ...base.coverage, afterHours: "Take a message and promise a callback by 9am." } },
    });
    expect(coverage.sync).toBe(true);
    expect(coverage.configVersion).toBe(before.version + 1);
    expect(coverage.changed).toEqual([{ field: "afterHours", before: "(empty)", after: "Take a message and promise a callback by 9am." }]);
    const active = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id, status: "active" } });
    expect(active.version).toBe(before.version + 1);
    expect(active.source).toBe("admin_edit");
    expect(active.settings).toMatchObject({ coverage: { afterHours: "Take a message and promise a callback by 9am." } });
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored.agentSyncStatus).toBe("syncing");
    const log = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "admin_edit" }, orderBy: { createdAt: "desc" } });
    expect(log.summary).toContain("Coverage");
    expect(log.after).toMatchObject({ kind: "admin_edit", step: 4, title: "Coverage", configVersion: before.version + 1 });

    const portal = await editClientStep(admin, { clientId: client.id, step: 10, payload: { ...base, portalOwnerEmail: "new-owner@example.com" } });
    expect(portal.sync).toBe(false);
    expect(portal.configVersion).toBeNull();
    expect(await prisma.agentConfig.count({ where: { clientId: client.id } })).toBe(before.version + 1);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).portalOwnerEmail).toBe("new-owner@example.com");
    const portalLog = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "admin_edit" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(portalLog.after)).not.toContain("new-owner@example.com");
    expect(portalLog.after).toMatchObject({ fields: [{ field: "portalOwnerEmail", value: "(changed)" }] });

    const contact = await editClientStep(admin, {
      clientId: client.id,
      step: 1,
      payload: { ...base, business: { ...base.business, contactName: "Dana Lee", publicPhone: "(888) 387-1525", contactPhone: "+14155550777" } },
    });
    expect(contact.changed).toEqual([
      { field: "contactName", before: "(empty)", after: "Dana Lee" },
      { field: "contactPhone", redacted: true },
      { field: "publicPhone", redacted: true },
    ]);
    const contactLog = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "admin_edit" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(contactLog.after)).not.toMatch(/\d{7,}/);
    const prompt = (await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id, status: "active" } })).promptText;
    expect(prompt.split("+18883871525")).toHaveLength(2);
    expect(prompt).not.toContain("+14155550777");

    const plan = await editClientStep(admin, { clientId: client.id, step: 3, payload: base });
    expect(plan.stripeWarning).toBe(false);
    await prisma.client.update({ where: { id: client.id }, data: { stripeSubscriptionId: "sub_test_1" } });
    expect((await editClientStep(admin, { clientId: client.id, step: 3, payload: base })).stripeWarning).toBe(true);
  });

  it("edit mode reads the client, never a stale wizard draft, and refuses unsubmitted clients", async () => {
    const client = await seedClient();
    await prisma.wizardDraft.create({
      data: {
        clientId: client.id,
        currentStep: 11,
        createdById: admin.id,
        payload: { version: 1, business: { name: "Stale Draft Name", timezone: "America/Chicago" }, coverage: { afterHours: "stale" } },
      },
    });
    const payload = await clientEditPayload(admin, client.id);
    expect(payload.business?.name).toBe("West Dental Lab");
    expect(payload.business?.timezone).toBe("America/New_York");
    expect(payload.coverage?.afterHours).toBeUndefined();
    expect(payload.features?.transferTargetsText).toBe("Front desk, +14155550100\nDr. Patel, +14155550123\nBilling, +14155550177");
    expect(payload.features?.weeklyHoursText).toBe("fri 09:00-17:00");
    expect(payload.knowledge?.staff).toBe("Owner: Dana Lee");

    await prisma.client.update({ where: { id: client.id }, data: { wizardSubmittedAt: null } });
    await expect(clientEditPayload(admin, client.id)).rejects.toThrow(/Finish the wizard/);
    await expect(editClientStep(admin, { clientId: client.id, step: 2, payload: { version: 1, websiteNotes: "x" } })).rejects.toThrow(/Finish the wizard/);
  });

  it("diffs a section field by field and hides contact values", () => {
    expect(diffSection("business", { name: "A", publicPhone: "+18883871525" }, { name: "B", publicPhone: "+18883871526" })).toEqual([
      { field: "name", before: "A", after: "B" },
      { field: "publicPhone", redacted: true },
    ]);
    expect(diffSection("websiteNotes", "old", "old")).toEqual([]);
    expect(diffSection("portalOwnerEmail", "a@x.com", "b@x.com")).toEqual([{ field: "portalOwnerEmail", redacted: true }]);
  });

  it("publishes end_call on every tool list and the client's call timing on the agent", async () => {
    const client = await seedClient();
    await prisma.client.update({
      where: { id: client.id },
      data: { coverage: { callTiming: { maxCallMinutes: 10, silenceSeconds: 20, reminderSeconds: 5 } } },
    });
    const voice = new MemoryVoice();
    const used = deps(voice, new MemoryBilling());
    await startProvisioning(admin, client.id, { numberApproved: true });
    await advanceProvisioning(admin, client.id, used);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    const tools = voice.llms.get(stored.retellLlmId ?? "")?.tools ?? [];
    expect(tools.at(-1)).toEqual(END_CALL_TOOL);
    expect(voice.agents.get(stored.retellAgentId ?? "")?.timing).toEqual({
      max_call_duration_ms: 600_000,
      end_call_after_silence_ms: 20_000,
      reminder_trigger_ms: 5_000,
      reminder_max_count: 1,
    });
    expect(voice.llms.get(stored.retellLlmId ?? "")?.prompt).toContain("immediately use the end_call tool");

    await prisma.client.update({ where: { id: client.id }, data: { features: { liveTransfer: false } } });
    await prisma.client.update({ where: { id: client.id }, data: { agentSyncStatus: "syncing", syncedConfigId: null } });
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    expect((voice.llms.get(stored.retellLlmId ?? "")?.tools ?? []).map((tool) => tool.name)).toEqual(["take_message", "end_call"]);

    const base = await clientEditPayload(admin, client.id);
    const edited = await editClientStep(admin, {
      clientId: client.id,
      step: 4,
      payload: { ...base, coverage: { ...base.coverage, callTiming: { maxCallMinutes: "25", silenceSeconds: "60", reminderSeconds: "12" } } },
    });
    expect(edited.sync).toBe(true);
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    expect(voice.agents.get(stored.retellAgentId ?? "")?.timing).toMatchObject({ max_call_duration_ms: 1_500_000, end_call_after_silence_ms: 60_000, reminder_trigger_ms: 12_000 });
    expect(callTimingOf({})).toEqual(CALL_TIMING_DEFAULTS);
    expect(() => coverageSchema.parse({ callTiming: { maxCallMinutes: "90" } })).toThrow(/at most 60/);
    expect(coverageSchema.parse({}).callTiming).toEqual(CALL_TIMING_DEFAULTS);
  });

  it("creates client zero with a wizard draft the Continue link can open, and stays idempotent", async () => {
    const first = await createClientZero(admin);
    expect(first.created).toBe(true);
    const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: first.id, discardedAt: null } });
    expect(draft.currentStep).toBe(1);
    expect(draft.payload).toMatchObject({ business: { name: "Alinstra", timezone: "America/New_York" }, phone: { tollFree: true } });
    expect(await prisma.knowledgeBase.count({ where: { clientId: first.id, status: "draft" } })).toBe(1);
    const client = await prisma.client.findUniqueOrThrow({ where: { id: first.id } });
    expect(client).toMatchObject({ internal: true, status: "lead", phone: { tollFree: true } });

    const again = await createClientZero(admin);
    expect(again).toEqual({ id: first.id, created: false });
    expect(await prisma.wizardDraft.count({ where: { clientId: first.id } })).toBe(1);

    await prisma.wizardDraft.deleteMany({ where: { clientId: first.id } });
    const repaired = await createClientZero(admin);
    expect(repaired).toEqual({ id: first.id, created: false });
    expect(await prisma.wizardDraft.count({ where: { clientId: first.id, discardedAt: null } })).toBe(1);

    await prisma.client.update({ where: { id: first.id }, data: { wizardSubmittedAt: new Date() } });
    await prisma.wizardDraft.deleteMany({ where: { clientId: first.id } });
    await createClientZero(admin);
    expect(await prisma.wizardDraft.count({ where: { clientId: first.id } })).toBe(0);
  });

  it("never buys a number until the admin approves it, then resumes the run", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    const used = deps(voice, new MemoryBilling());
    await startProvisioning(admin, client.id);
    expect(await advanceProvisioning(admin, client.id, used)).toEqual({ status: AWAITING_NUMBER_APPROVAL });
    expect(voice.creates.number).toBe(0);
    expect(voice.creates.agent).toBe(1);
    const run = await prisma.provisioningRun.findFirstOrThrow({ where: { clientId: client.id }, include: { steps: true } });
    expect(run.status).toBe("running");
    expect(run.numberApprovedAt).toBeNull();
    expect(run.steps.find((step) => step.name === "retell_number")?.status).toBe(AWAITING_NUMBER_APPROVAL);
    expect(run.steps.find((step) => step.name === "retell_bind")?.status).toBe("pending");
    expect(await advanceProvisioning(admin, client.id, used)).toEqual({ status: AWAITING_NUMBER_APPROVAL });
    expect(voice.creates.number).toBe(0);
    expect(await latestProvisionFailure(client.id)).toBeNull();

    await approveNumberPurchase(admin, client.id);
    const approved = await prisma.provisioningRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: true } });
    expect(approved.numberApprovedAt).toBeInstanceOf(Date);
    expect(approved.steps.find((step) => step.name === "retell_number")?.status).toBe("pending");
    expect(await advanceProvisioning(admin, client.id, used)).toEqual({ status: "succeeded" });
    expect(voice.creates.number).toBe(1);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).phoneE164).toMatch(/^\+1555/);
    expect(numberPurchaseFor({ tollFree: true }, { areaCode: null, tollFree: false })).toEqual({ tollFree: true, areaCode: null, monthlyCents: 500, inboundPerMinuteCents: 6 });
    expect(numberPurchaseFor({ areaCode: "423" }, { areaCode: null, tollFree: false })).toEqual({ tollFree: false, areaCode: "423", monthlyCents: 200, inboundPerMinuteCents: 0 });
  });

  it("publishes the Retell voice id for the client's wizard selection and defaults to Brynne", async () => {
    const chosen = await seedClient({ name: "Chosen" });
    await prisma.client.update({ where: { id: chosen.id }, data: { voice: { voiceId: "voice_4", assistantName: "Ava" } } });
    const voice = new MemoryVoice();
    const used = deps(voice, new MemoryBilling());
    await startProvisioning(admin, chosen.id, { numberApproved: true });
    expect(await advanceProvisioning(admin, chosen.id, used)).toEqual({ status: "succeeded" });
    expect(voice.agents.get(`agent_${chosen.id}`)?.voiceId).toBe("minimax-Jason");

    const unset = await seedClient({ name: "Unset" });
    await startProvisioning(admin, unset.id, { numberApproved: true });
    expect(await advanceProvisioning(admin, unset.id, used)).toEqual({ status: "succeeded" });
    expect(voice.agents.get(`agent_${unset.id}`)?.voiceId).toBe("retell-Brynne");

    // Changing the voice later flows through sync.
    await prisma.client.update({ where: { id: chosen.id }, data: { voice: { voiceId: "voice_2" }, agentSyncStatus: "pending" } });
    expect(await syncProvisionedAgent(chosen.id, used)).toBe("in_sync");
    expect(voice.agents.get(`agent_${chosen.id}`)?.voiceId).toBe("retell-Della");
  });

  it("describes the latest failed run for the failure email", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    voice.failSync = true;
    await prisma.user.create({ data: { id: admin.id, name: "Admin", email: "ops@example.com", role: "admin" } });
    await startProvisioning(admin, client.id, { numberApproved: true });
    expect(await advanceProvisioning(admin, client.id, deps(voice, new MemoryBilling()))).toEqual({ status: "failed" });
    const failure = await latestProvisionFailure(client.id);
    expect(failure).toEqual({
      clientId: client.id,
      clientName: "West Dental Lab",
      stepName: "retell_bind",
      stepLabel: "Connect and publish",
      error: "Retell sync failed",
      runOwnerEmail: "ops@example.com",
    });
  });

  it("normalizes and validates the public phone and email", () => {
    const parsed = businessSchema.parse({
      name: "West",
      industry: "hvac",
      contactName: "Dana",
      contactEmail: "dana@example.com",
      publicPhone: "(888) 387-1525",
      publicEmail: " Hello@Example.com ",
    });
    expect(parsed.publicPhone).toBe("+18883871525");
    expect(parsed.publicEmail).toBe("Hello@Example.com");
    expect(() => businessSchema.parse({ name: "West", industry: "hvac", contactName: "Dana", contactEmail: "dana@example.com", publicPhone: "12" })).toThrow(/public phone/i);
    expect(businessSchema.parse({ name: "West", industry: "hvac", contactName: "Dana", contactEmail: "dana@example.com", publicPhone: "" }).publicPhone).toBeUndefined();
  });
});
