import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "./changes";
import { prisma } from "./client";
import {
  LIVE_TRANSFER_TARGETS_ERROR,
  migrateNotesOnlyTransferTargets,
  parseTransferTargets,
} from "./domain";
import { seedPlans } from "./plans";
import { resetTestDatabase } from "./reset-test-database";
import { startWizard, submitWizard } from "./wizard";

const admin: Actor = { id: "user_transfer_admin", role: "admin" };

async function freshDraft(name: string) {
  const client = await startWizard(admin, name);
  const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
  const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
  return { client, plan, draft };
}

function basePayload(planId: string, features: Record<string, unknown>) {
  return {
    version: 1 as const,
    business: {
      name: "Transfer Co",
      industry: "hvac" as const,
      contactName: "Ada",
      contactEmail: "ada@example.com",
      timezone: "America/New_York",
    },
    knowledge: {
      hours: "Mon-Fri 9:00-17:00",
      services: "Repairs",
      faqs: "Where are you?",
      policies: "No walk-ins",
      staff: "Sam",
    },
    plan: { planId, setupFeeWaived: false },
    portalOwnerEmail: "owner@example.com",
    compliance: { aiDisclosure: true as const, recordingNotice: true },
    features,
  };
}

describe("transfer submit + migration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.user.create({
      data: { id: admin.id, name: "Admin", email: "transfer-admin@example.com", role: "admin" },
    });
    await seedPlans();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("migrates notes-only transferTargetsText into transferNotes", () => {
    const migrated = migrateNotesOnlyTransferTargets({
      transferTargetsText: "Just me (owner) for quotes",
      transferNotes: null,
      liveTransfer: false,
    });
    expect(migrated.transferNotes).toBe("Just me (owner) for quotes");
    expect(migrated.transferTargetsText).toBe("");
  });

  it("submits when liveTransfer is false with notes-only text", async () => {
    const { client, plan, draft } = await freshDraft("Notes Only");
    await expect(
      submitWizard(admin, {
        clientId: client.id,
        updatedAt: draft.updatedAt.toISOString(),
        payload: basePayload(plan.id, {
          liveTransfer: false,
          transferTargetsText: "Just me, for quotes",
          messageRecipients: "owner@example.com",
          bookingMode: "request_only",
        }),
      }),
    ).resolves.toBeTruthy();
    const saved = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    const features = saved.features as { transferNotes?: string; transferTargetsText?: string };
    expect(features.transferNotes).toMatch(/Just me/i);
    expect(features.transferTargetsText ?? "").toBe("");
    expect(await prisma.transferTarget.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("errors when liveTransfer is true with no targets", async () => {
    const { client, plan, draft } = await freshDraft("Need Targets");
    await expect(
      submitWizard(admin, {
        clientId: client.id,
        updatedAt: draft.updatedAt.toISOString(),
        payload: basePayload(plan.id, {
          liveTransfer: true,
          transferTargetsText: "",
          messageRecipients: "owner@example.com",
          bookingMode: "request_only",
        }),
      }),
    ).rejects.toThrow(LIVE_TRANSFER_TARGETS_ERROR);
  });

  it("migrates an old notes-only draft and does not throw when liveTransfer is false", async () => {
    const { client, plan, draft } = await freshDraft("Old Draft");
    await prisma.wizardDraft.update({
      where: { id: draft.id },
      data: {
        payload: JSON.parse(
          JSON.stringify(
            basePayload(plan.id, {
              liveTransfer: false,
              transferTargetsText: "Owner for sales questions only",
            }),
          ),
        ),
      },
    });
    const refreshed = await prisma.wizardDraft.findFirstOrThrow({ where: { id: draft.id } });
    await expect(
      submitWizard(admin, {
        clientId: client.id,
        updatedAt: refreshed.updatedAt.toISOString(),
        payload: basePayload(plan.id, {
          liveTransfer: false,
          transferTargetsText: "Owner for sales questions only",
          messageRecipients: "owner@example.com",
          bookingMode: "request_only",
        }),
      }),
    ).resolves.toBeTruthy();
  });

  it("parses forgiving transfer lines", () => {
    expect(parseTransferTargets("Owner: 4235551234")[0]?.e164).toBe("+14235551234");
  });
});
