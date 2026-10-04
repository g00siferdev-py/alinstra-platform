import { PRIVACY_RULE, TEMPLATE_VERSION } from "@alinstra/agent";
import { MemoryBilling, MemoryVoice } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { businessSchema } from "./domain";
import {
  advanceProvisioning,
  decideTransfer,
  inboundVariables,
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
    voiceId: "retell-Cimo",
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
    await startProvisioning(admin, client.id);
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
    expect(tools.map((tool) => tool.name)).toEqual(["take_message", "transfer", "transfer_front_desk", "transfer_dr_patel", "transfer_billing"]);
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
    await startProvisioning(admin, client.id);
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
    expect(names).toEqual(["take_message", "transfer", "transfer_owner_line"]);
    expect(textOf(voice.llms.get(stored.retellLlmId ?? "")?.tools ?? [])).not.toContain("0188");

    await prisma.client.update({ where: { id: client.id }, data: { publicPhone: "+18883871525", agentSyncStatus: "syncing", syncedConfigId: null } });
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    const refreshed = voice.llms.get(stored.retellLlmId ?? "")?.prompt ?? "";
    expect(refreshed.split("+18883871525")).toHaveLength(2);
    expect(refreshed).not.toContain(stored.phoneE164 ?? "none");
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
