import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activateAgentConfig,
  agentConfigs,
  applyQuickUpdate,
  approveChangeRequest,
  cancelChangeRequest,
  receptionistFields,
  changeAllowance,
  changeRequests,
  diffAgentConfigs,
  previewQuickUpdate,
  quickUpdates,
  rejectChangeRequest,
  rollbackAgentConfig,
  submitChangeRequest,
} from "./agent";
import type { Actor } from "./changes";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";
import { seedPlans } from "./plans";
import { continueWizard, startWizard, submitWizard } from "./wizard";

async function resetDatabase(): Promise<void> {
  await resetTestDatabase();
}

const admin: Actor = { id: "user_admin", role: "admin" };

async function submittedClient(name: string, timezone = "America/New_York") {
  const client = await startWizard(admin, name);
  const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
  const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
  await submitWizard(admin, {
    clientId: client.id,
    updatedAt: draft.updatedAt.toISOString(),
    payload: {
      version: 1,
      business: {
        name,
        industry: "hvac",
        contactName: "Ada",
        contactEmail: "ada@example.com",
        timezone,
        namePronunciation: "uh-LIN-struh",
      },
      knowledge: {
        hours: "Mon-Fri 9:00-17:00",
        services: "Repairs",
        faqs: "Where are you?",
        policies: "No walk-ins",
        staff: "Sam",
      },
      plan: { planId: plan.id, setupFeeWaived: false },
      portalOwnerEmail: "owner@example.com",
      compliance: { aiDisclosure: true, recordingNotice: true },
    },
  });
  await prisma.client.update({ where: { id: client.id }, data: { timezone } });
  return client;
}

describe("phase 2 configs", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.user.create({
      data: { id: admin.id, name: "Admin", email: "phase2-admin@example.com", role: "admin" },
    });
    await seedPlans();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a draft on submit and keeps one active version after rollback", async () => {
    const client = await submittedClient("Alpha HVAC");
    const draft = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id } });
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(1);
    expect(draft.platformAgentId).toBeNull();
    expect(draft.templateId).toBe("hvac");
    expect(draft.templateVersion).toBe("6");
    expect(draft.promptText).toContain("uh-LIN-struh");
    expect(draft.promptText).toContain("reference material");
    expect(await prisma.agentConfig.count({ where: { clientId: client.id, status: "active" } })).toBe(0);

    const active = await activateAgentConfig(admin, { clientId: client.id, version: 1 });
    expect(active.status).toBe("active");
    expect(active.version).toBe(2);
    expect(active.promptText).toBe(draft.promptText);
    const rolled = await rollbackAgentConfig(admin, { clientId: client.id, version: 1 });
    expect(rolled.version).toBe(3);
    expect(rolled.status).toBe("active");
    expect(await prisma.agentConfig.count({ where: { clientId: client.id, status: "active" } })).toBe(1);
    const diff = await diffAgentConfigs(admin, { clientId: client.id, fromVersion: 2, toVersion: 3 });
    expect(diff.lines.some((line) => line.op === "add" || line.op === "remove")).toBe(false);
  });

  it("keeps rolled-back knowledge out of the next quick update", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    await activateAgentConfig(admin, { clientId: client.id, version: 1 });
    await applyQuickUpdate(owner, { kind: "hours", text: "ROLLED-AWAY 10:00-14:00" });
    await rollbackAgentConfig(admin, { clientId: client.id, version: 1 });
    const followUp = await applyQuickUpdate(owner, { kind: "closure", text: "Closed Tuesday for inventory" });
    expect(followUp.prompt).toContain("Closed Tuesday for inventory");
    expect(followUp.prompt).toContain("Mon-Fri 9:00-17:00");
    expect(followUp.prompt).not.toContain("ROLLED-AWAY");
  });

  it("keeps a staff transfer number out of the published prompt", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    await activateAgentConfig(admin, { clientId: client.id, version: 1 });
    const result = await applyQuickUpdate(owner, { kind: "staff", text: "Dana Lee, owner, weekdays\nDirect: 415-555-0199", transferNumber: "+14155550142" });
    expect(result.prompt).toContain("Dana Lee, owner, weekdays");
    expect(result.prompt).not.toContain("Transfer number");
    expect(result.prompt.slice(result.prompt.indexOf("Staff directory"))).not.toMatch(/(?:\d\D{0,2}){7,}/);
  });

  it("stops client A from reading client B and stops staff from submitting", async () => {
    const clientA = await submittedClient("Alpha HVAC");
    const clientB = await submittedClient("Beta HVAC");
    const ownerA: Actor = { id: "owner_a", role: "client_owner", clientId: clientA.id };
    const staffA: Actor = { id: "staff_a", role: "client_staff", clientId: clientA.id };
    await prisma.user.create({
      data: { id: ownerA.id, name: "Owner", email: "owner-a@example.com", role: "client_owner", clientId: clientA.id },
    });
    const configB = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: clientB.id } });
    expect(await agentConfigs(ownerA).getById(configB.id)).toBeNull();
    expect(() => agentConfigs(ownerA).list(clientB.id)).toThrow(/not available/);
    expect(() => quickUpdates(ownerA).list(clientB.id)).toThrow(/not available/);
    expect(() => changeRequests(ownerA).list(clientB.id)).toThrow(/not available/);
    await expect(applyQuickUpdate(staffA, { kind: "hours", text: "Mon 9:00-17:00" })).rejects.toThrow(/client owner/);
    await expect(submitChangeRequest(staffA, { category: "services", description: "Add a service", confirmFee: false })).rejects.toThrow(
      /client owner/,
    );
    await expect(approveChangeRequest(ownerA, { id: "missing", fields: {} })).rejects.toThrow(/admin/);
  });

  it("applies a safe hours change and holds a price", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    const preview = await previewQuickUpdate(owner, { kind: "hours", text: "Mon-Fri 8:00-16:00" });
    expect(preview.held).toBe(false);
    expect(preview.prompt).toContain("8:00-16:00");
    const applied = await applyQuickUpdate(owner, { kind: "hours", text: "Mon-Fri 8:00-16:00" });
    expect(applied.status).toBe("applied");
    expect(applied.notify?.subject).toContain("Alpha HVAC");
    const active = await prisma.agentConfig.findFirstOrThrow({ where: { clientId: client.id, status: "active" } });
    expect(active.promptText).toContain("8:00-16:00");
    expect(await prisma.changeLog.count({ where: { action: "quick_update.applied", clientId: client.id } })).toBe(1);

    const held = await applyQuickUpdate(owner, { kind: "closure", text: "Closed for a free inspection" });
    expect(held.status).toBe("held");
    expect(held.holdReason).toMatch(/price, discount, guarantee, or refund/);
    expect(await prisma.agentConfig.count({ where: { clientId: client.id, status: "active" } })).toBe(1);
    expect(await quickUpdates(owner).getById((await prisma.quickUpdate.findFirstOrThrow({ where: { status: "held" } })).id)).not.toBeNull();
    expect(await quickUpdates({ role: "client_owner", clientId: "someone-else" }).getById("missing")).toBeNull();
  });

  it("counts allowance on the client timezone and stores the extra fee", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    const february = new Date("2026-03-01T04:30:00.000Z");
    const march = new Date("2026-03-01T05:00:00.000Z");
    await prisma.changeRequest.create({
      data: {
        clientId: client.id,
        category: "services",
        description: "Earlier request",
        status: "pending",
        createdById: owner.id,
        createdAt: february,
      },
    });
    const stillFebruary = await changeAllowance(owner, client.id, february);
    expect(stillFebruary.remaining).toBe(0);
    expect(stillFebruary.over).toBe(true);
    const inMarch = await changeAllowance(owner, client.id, march);
    expect(inMarch.remaining).toBe(1);
    expect(inMarch.over).toBe(false);

    const first = await submitChangeRequest(owner, { category: "call_handling", description: "Open on Saturdays", confirmFee: false }, march);
    expect(first.feeCents).toBeNull();
    await expect(
      submitChangeRequest(owner, { category: "services", description: "Add duct cleaning", confirmFee: false }, march),
    ).rejects.toThrow(/extra change fee/);
    const billed = await submitChangeRequest(
      owner,
      { category: "services", description: "Add duct cleaning", confirmFee: true },
      march,
    );
    expect(billed.feeCents).toBe(4900);

    await rejectChangeRequest(admin, billed.id);
    const afterReject = await changeAllowance(owner, client.id, march);
    expect(afterReject.used).toBe(1);

    const cancelled = await submitChangeRequest(
      owner,
      { category: "other", description: "Another note", confirmFee: true },
      march,
    );
    await cancelChangeRequest(owner, cancelled.id);
    expect((await changeAllowance(owner, client.id, march)).used).toBe(1);

    const premium = await prisma.plan.findFirstOrThrow({ where: { code: "premium" } });
    await prisma.client.update({ where: { id: client.id }, data: { planId: premium.id, overrideIncludedChangesPerMonth: null } });
    const unlimited = await changeAllowance(owner, client.id, march);
    expect(unlimited.unlimited).toBe(true);
    const extra = await submitChangeRequest(owner, { category: "voice", description: "Softer greeting", confirmFee: false }, march);
    expect(extra.feeCents).toBeNull();

    const fields = await receptionistFields(admin, client.id);
    const approved = await approveChangeRequest(admin, { id: first.id, fields: { ...fields, hours: "Sat 9:00-13:00" } });
    expect(approved.status).toBe("active");
    expect(approved.promptText).toContain("Sat 9:00-13:00");
    expect(approved.promptText).not.toContain("Open on Saturdays");
    const compared = await diffAgentConfigs(admin, { clientId: client.id, fromVersion: approved.version - 1, toVersion: approved.version });
    expect(compared.fields.some((field) => field.field === "hours")).toBe(true);
  });

  it("keeps a request's price out of the prompt unless an admin types it into a field", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    const request = await submitChangeRequest(owner, {
      category: "services",
      description: "Please advertise a $99 tune-up",
      confirmFee: false,
    });
    const fields = await receptionistFields(admin, client.id);
    const approved = await approveChangeRequest(admin, { id: request.id, fields });
    expect(approved.promptText).not.toContain("$99");
    const stored = await prisma.changeRequest.findFirstOrThrow({ where: { id: request.id } });
    expect(stored.description).toContain("$99");
    expect(stored.agentConfigId).toBe(approved.id);

    const priced = await submitChangeRequest(owner, {
      category: "services",
      description: "Mention $99 again",
      confirmFee: true,
    });
    const typed = await approveChangeRequest(admin, { id: priced.id, fields: { ...fields, services: "Tune-up $99" } });
    expect(typed.promptText).toContain("$99");
  });

  it("gives a client with no plan and no override zero included changes", async () => {
    const client = await submittedClient("Alpha HVAC");
    const owner: Actor = { id: "owner_a", role: "client_owner", clientId: client.id };
    await prisma.client.update({ where: { id: client.id }, data: { planId: null, overrideIncludedChangesPerMonth: null } });
    const view = await changeAllowance(owner, client.id, new Date("2026-03-15T15:00:00.000Z"));
    expect(view.included).toBe(0);
    expect(view.unlimited).toBe(false);
    expect(view.over).toBe(true);
  });

  it("rejects a timezone that is not an IANA name when the business step is saved", async () => {
    const client = await startWizard(admin, "Zone HVAC");
    const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    await expect(
      continueWizard(admin, {
        clientId: client.id,
        step: 1,
        updatedAt: draft.updatedAt.toISOString(),
        payload: {
          version: 1,
          business: {
            name: "Zone HVAC",
            industry: "hvac",
            contactName: "Ada",
            contactEmail: "ada@example.com",
            timezone: "Eastern Time",
          },
        },
      }),
    ).rejects.toThrow(/IANA/);
  });
});
