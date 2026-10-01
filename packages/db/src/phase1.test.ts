import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { reserveDocument, knowledgeDocuments } from "./knowledge";
import { seedPlans, updatePlan } from "./plans";
import type { Actor } from "./changes";
import { startWizard, submitWizard, wizardDrafts } from "./wizard";

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "change_log", "knowledge_document", "knowledge_base", "wizard_draft", "session", "account", "twoFactor", "verification", "invite", "user", "client", "plan" CASCADE`,
  );
}

const admin: Actor = { id: "user_admin", role: "admin" };

describe("phase 1 tenancy", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.user.create({
      data: { id: admin.id, name: "Admin", email: "phase1-admin@example.com", role: "admin" },
    });
    await seedPlans();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("hides another client's draft, knowledge, documents, and changelog", async () => {
    const clientA = await startWizard(admin, "Alpha");
    const clientB = await startWizard(admin, "Beta");
    const staffA: Actor = { id: "staff_a", role: "client_staff", clientId: clientA.id };
    await prisma.user.create({
      data: { id: staffA.id, name: "Staff", email: "staff-phase1@example.com", role: "client_staff", clientId: clientA.id },
    });
    const document = await reserveDocument(admin, {
      clientId: clientB.id,
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 12,
    });

    expect(await wizardDrafts(staffA).getByClientId(clientB.id)).toBeNull();
    expect(await wizardDrafts({ role: "client_owner", clientId: clientA.id }).getByClientId(clientA.id)).toBeNull();
    expect(await knowledgeDocuments(staffA).getById(document.id)).toBeNull();
    const visibleDocs = await knowledgeDocuments(staffA).list(clientA.id);
    expect(visibleDocs.map((row) => row.id)).not.toContain(document.id);
    expect(() => knowledgeDocuments(staffA).list(clientB.id)).toThrow(/not available/);
  });

  it("rejects a storage key that names another client", async () => {
    const clientA = await startWizard(admin, "Alpha");
    const clientB = await startWizard(admin, "Beta");
    const document = await reserveDocument(admin, {
      clientId: clientB.id,
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 4,
    });
    expect(document.storageKey.startsWith(`clients/${clientB.id}/`)).toBe(true);
    expect(document.storageKey.startsWith(`clients/${clientA.id}/`)).toBe(false);
    expect(await knowledgeDocuments({ role: "client_staff", clientId: clientA.id }).getById(document.id)).toBeNull();
  });

  it("refuses plan edits from a client owner", async () => {
    const clientA = await startWizard(admin, "Alpha");
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    await expect(
      updatePlan(
        { id: "owner", role: "client_owner", clientId: clientA.id },
        plan.id,
        {
          monthlyPriceCents: 1,
          includedMinutes: 1,
          overagePerMinuteCents: 1,
          setupFeeCents: 1,
          includedChangesPerMonth: 1,
          extraChangeFeeCents: 1,
        },
      ),
    ).rejects.toThrow(/admin/);
  });

  it("rolls back submit when the plan does not exist and blocks healthcare without a review note", async () => {
    const client = await startWizard(admin, "Clinic");
    const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    const base = {
      clientId: client.id,
      updatedAt: draft.updatedAt.toISOString(),
      payload: {
        version: 1,
        business: {
          name: "Clinic",
          industry: "hvac",
          contactName: "Ada",
          contactEmail: "ada@example.com",
          timezone: "America/New_York",
        },
        plan: { planId: "missing-plan", setupFeeWaived: false },
        portalOwnerEmail: "owner@example.com",
        compliance: { aiDisclosure: true, healthcareSensitive: false, complianceReviewDone: false, complianceReviewNote: "" },
      },
    };
    await expect(submitWizard(admin, base)).rejects.toThrow(/Choose a plan/);
    expect((await prisma.client.findUnique({ where: { id: client.id } }))?.wizardSubmittedAt).toBeNull();
    expect(await prisma.changeLog.count({ where: { clientId: client.id, action: "wizard.submitted" } })).toBe(0);

    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    const reloaded = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    await expect(
      submitWizard(admin, {
        ...base,
        updatedAt: reloaded.updatedAt.toISOString(),
        payload: {
          ...(base.payload as object),
          business: {
            name: "Clinic",
            industry: "dental",
            contactName: "Ada",
            contactEmail: "ada@example.com",
            timezone: "America/New_York",
          },
          compliance: { aiDisclosure: true, healthcareSensitive: true, complianceReviewDone: false, complianceReviewNote: "" },
          plan: { planId: plan.id, setupFeeWaived: false },
        },
      }),
    ).rejects.toThrow(/compliance review/);
    expect((await prisma.client.findUnique({ where: { id: client.id } }))?.wizardSubmittedAt).toBeNull();
  });

  it("stores the owner email on submit and does not create an invite", async () => {
    const client = await startWizard(admin, "Clinic");
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "professional" } });
    const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    const submitted = await submitWizard(admin, {
      clientId: client.id,
      updatedAt: draft.updatedAt.toISOString(),
      payload: {
        version: 1,
        business: {
          name: "Clinic",
          industry: "hvac",
          contactName: "Ada",
          contactEmail: "ada@example.com",
          timezone: "America/New_York",
        },
        plan: { planId: plan.id, setupFeeWaived: true },
        portalOwnerEmail: "owner@example.com",
        compliance: { aiDisclosure: true },
      },
    });
    expect(submitted.status).toBe("lead");
    expect(submitted.wizardSubmittedAt).not.toBeNull();
    expect(submitted.portalOwnerEmail).toBe("owner@example.com");
    expect(await prisma.invite.count()).toBe(0);
    expect(await prisma.changeLog.count({ where: { action: "wizard.submitted", clientId: client.id } })).toBe(1);
  });
});
