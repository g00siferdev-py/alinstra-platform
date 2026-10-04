import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { approveQuickUpdate, rejectQuickUpdate } from "./agent";
import { prisma } from "./client";
import { needsOwnNumberForwarding, OWNER_BLOCKED_STEP_HINT, phoneModeOf } from "./domain";
import { OWNER_STEP_HOLD_KIND, VOICE_HOLD_REASON } from "./owner-edit-hold";
import { resetTestDatabase } from "./reset-test-database";
import { clientEditPayload, editClientStep } from "./wizard";

const admin = { id: "admin_phase5", role: "admin" as const };

async function seedClient(name = "North HVAC") {
  const plan = await prisma.plan.upsert({
    where: { code: "plan_p5" },
    update: {},
    create: {
      code: "plan_p5",
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
      name,
      status: "live",
      industry: "hvac",
      timezone: "America/New_York",
      wizardSubmittedAt: new Date(),
      planId: plan.id,
      contactEmail: "owner@example.com",
      weeklyHours: { fri: { start: "09:00", end: "17:00" } },
      compliance: { healthcareSensitive: false, healthcareTouched: true },
      features: { messageRecipients: "office@example.com", liveTransfer: true, bookingMode: "request_only" },
      voice: { voiceId: "voice_1", assistantName: "Ava", disclosureMode: "on_request" },
      coverage: { afterHours: "Take a message." },
      phone: { mode: "new_number" },
    },
  });
  await prisma.agentConfig.create({
    data: {
      clientId: client.id,
      version: 1,
      status: "active",
      promptText: "Hello.",
      templateId: "general",
      templateVersion: "6",
      documentIds: [],
      tools: [],
      settings: {},
      greeting: "Thanks for calling.",
      source: "test",
      createdById: admin.id,
    },
  });
  await prisma.knowledgeBase.create({
    data: { clientId: client.id, version: 1, status: "active", hours: "Mon-Fri 9-5", staff: "Dana" },
  });
  const owner = await prisma.user.create({
    data: { id: `owner_${client.id}`, name: "Owner", email: `owner_${client.id}@example.com`, role: "client_owner", clientId: client.id },
  });
  const staff = await prisma.user.create({
    data: { id: `staff_${client.id}`, name: "Staff", email: `staff_${client.id}@example.com`, role: "client_staff", clientId: client.id },
  });
  return { client, owner, staff, plan };
}

describe("phase 5 owner edit", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets the owner edit their client and writes an owner_edit change log", async () => {
    const { client, owner } = await seedClient();
    const actor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    const before = await clientEditPayload(actor, client.id);
    const result = await editClientStep(actor, {
      clientId: client.id,
      step: 1,
      payload: { ...before, business: { ...before.business, contactName: "Pat Owner" } },
    });
    expect(result.changed).toEqual([{ field: "contactName", before: "(empty)", after: "Pat Owner" }]);
    // Not provisioned yet, so rebuild writes a new config without enqueueing a Retell sync.
    expect(result.configVersion).toBe(2);
    expect(result.sync).toBe(false);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).contactName).toBe("Pat Owner");
    const log = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "owner_edit" }, orderBy: { createdAt: "desc" } });
    expect(log.summary).toContain("Business and contact");
    expect(log.after).toMatchObject({ kind: "owner_edit", step: 1, title: "Business and contact" });
    expect(log.actorRole).toBe("client_owner");
  });

  it("refuses staff edits and blocked plan/compliance steps, and scopes by clientId", async () => {
    const { client, owner, staff } = await seedClient();
    const other = await seedClient("Other Co");
    const base = await clientEditPayload({ id: owner.id, role: "client_owner", clientId: client.id }, client.id);
    await expect(
      editClientStep({ id: staff.id, role: "client_staff", clientId: client.id }, { clientId: client.id, step: 1, payload: base }),
    ).rejects.toThrow(/owner or an admin/i);
    await expect(
      editClientStep({ id: owner.id, role: "client_owner", clientId: client.id }, { clientId: client.id, step: 3, payload: base }),
    ).rejects.toThrow(OWNER_BLOCKED_STEP_HINT);
    await expect(
      editClientStep({ id: owner.id, role: "client_owner", clientId: client.id }, { clientId: client.id, step: 9, payload: base }),
    ).rejects.toThrow(OWNER_BLOCKED_STEP_HINT);
    await expect(
      editClientStep({ id: owner.id, role: "client_owner", clientId: client.id }, { clientId: other.client.id, step: 1, payload: base }),
    ).rejects.toThrow(/owner or an admin|not available/i);
    await expect(clientEditPayload({ id: owner.id, role: "client_owner", clientId: client.id }, other.client.id)).rejects.toThrow(/owner or an admin/i);
  });

  it("holds a voice change for admin review and publishes a safe business edit directly", async () => {
    const { client, owner } = await seedClient();
    const actor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    const base = await clientEditPayload(actor, client.id);

    const held = await editClientStep(actor, {
      clientId: client.id,
      step: 6,
      payload: { ...base, voice: { ...base.voice, voiceId: "voice_2", assistantName: "Riley" } },
    });
    expect(held.held).toBe(true);
    expect(held.holdReason).toBe(VOICE_HOLD_REASON);
    expect(held.sync).toBe(false);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).voice).toMatchObject({ voiceId: "voice_1" });
    const row = await prisma.quickUpdate.findFirstOrThrow({ where: { clientId: client.id, status: "held" } });
    expect(row.kind).toBe(OWNER_STEP_HOLD_KIND);

    const direct = await editClientStep(actor, {
      clientId: client.id,
      step: 2,
      payload: { ...base, websiteNotes: "Mention the parking lot behind the shop." },
    });
    expect(direct.held).toBe(false);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).websiteNotes).toContain("parking lot");

    await approveQuickUpdate(admin, row.id);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).voice).toMatchObject({ voiceId: "voice_2", assistantName: "Riley" });
    expect(await prisma.changeLog.count({ where: { clientId: client.id, action: "owner_edit" } })).toBeGreaterThan(0);
  });

  it("gates the own-number forwarding page by phone.mode", () => {
    expect(phoneModeOf({ mode: "forward" })).toBe("forward");
    expect(phoneModeOf({ mode: "new_number" })).toBe("new_number");
    expect(phoneModeOf({ mode: "own_number" })).toBeNull();
    expect(phoneModeOf(null)).toBeNull();
    expect(needsOwnNumberForwarding({ mode: "forward" })).toBe(true);
    expect(needsOwnNumberForwarding({ mode: "new_number" })).toBe(false);
  });

  it("records a rejection reason the owner can read", async () => {
    const { client, owner } = await seedClient();
    const actor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    const base = await clientEditPayload(actor, client.id);
    await editClientStep(actor, {
      clientId: client.id,
      step: 6,
      payload: { ...base, voice: { ...base.voice, assistantName: "Sam" } },
    });
    const row = await prisma.quickUpdate.findFirstOrThrow({ where: { clientId: client.id, status: "held" } });
    await rejectQuickUpdate(admin, row.id, "Please keep the assistant name Ava for now.");
    const rejected = await prisma.quickUpdate.findUniqueOrThrow({ where: { id: row.id } });
    expect(rejected.status).toBe("rejected");
    expect(rejected.holdReason).toBe("Please keep the assistant name Ava for now.");
  });
});
