import { MemoryBilling, MemoryVoice, overageLookupKey } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  approveAutoGoLive,
  declineAutoGoLive,
  pauseClientByAdmin,
  PLAN_SEEDS,
  resumeClientByAdmin,
  runAutoGoLive,
  setAutoGoLive,
  type AutoGoLiveDeps,
} from "./index";
import { prisma } from "./client";
import { inboundCallPayload } from "./stripe-events";
import { resetTestDatabase } from "./reset-test-database";
import { syncStripePrices } from "./stripe-sync";

const admin = { id: "admin_phase_q", role: "admin" as const };

function okText(ok = true, reason = "") {
  return {
    complete: async () => ({
      text: JSON.stringify({ ok, reason }),
      inputTokens: 1,
      outputTokens: 1,
      model: "fake",
    }),
  };
}

function deps(text = okText(), allowTest = false): AutoGoLiveDeps & { sent: Array<{ to: string; subject: string }> } {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return {
    text,
    provision: {
      voice: new MemoryVoice(),
      billing: new MemoryBilling(),
      appUrl: "https://alinstra.com",
      danielNumber: null,
      danielEmail: "daniel@alinstra.com",
      defaultAreaCode: "423",
      defaultTollFree: false,
    },
    adminEmail: "daniel@alinstra.com",
    appUrl: "https://alinstra.com",
    tollFree: "+18883871525",
    dailyCap: 15,
    allowTest,
    sleep: async () => undefined,
    send: async (message) => {
      sent.push(message);
    },
    sent,
  };
}

let readySeq = 0;

async function readyClient(overrides: Record<string, unknown> = {}) {
  readySeq += 1;
  const email = `owner${readySeq}@example.com`;
  const portalEmail = typeof overrides.portalOwnerEmail === "string" ? overrides.portalOwnerEmail : email;
  const phone = typeof overrides.contactPhone === "string" ? overrides.contactPhone : `+1555555${String(100 + readySeq).padStart(4, "0")}`;
  const client = await prisma.client.create({
    data: {
      name: "Harbor Heat",
      status: "lead",
      selfServe: true,
      billingStatus: "paid",
      stripeSubscriptionId: `sub_q_${readySeq}`,
      stripeLivemode: true,
      wizardSubmittedAt: new Date(),
      timezone: "America/New_York",
      weeklyHours: { mon: "09:00-17:00" },
      industry: "hvac",
      ...overrides,
      portalOwnerEmail: portalEmail,
      contactPhone: phone,
    },
  });
  await prisma.user.create({
    data: {
      id: `user_${client.id}`,
      email,
      name: "Owner",
      role: "client_owner",
      clientId: client.id,
      emailVerified: overrides.emailVerified === false ? false : true,
    },
  });
  await prisma.knowledgeBase.create({
    data: {
      clientId: client.id,
      version: 1,
      status: "submitted",
      services: "Heating and cooling repair",
      faqs: "We serve the county",
    },
  });
  await prisma.agentConfig.create({
    data: {
      clientId: client.id,
      version: 1,
      status: "draft",
      promptText: "Answer the phone.",
      templateId: "hvac",
      templateVersion: "7",
      documentIds: [],
      tools: [],
      settings: {},
      source: "test",
      createdById: admin.id,
    },
  });
  return client;
}

describe("Phase Q auto go-live and Solo price", () => {
  beforeEach(resetTestDatabase);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores the Solo standard price on PLAN_SEEDS", () => {
    const solo = PLAN_SEEDS.find((plan) => plan.code === "solo");
    expect(solo).toMatchObject({
      monthlyPriceCents: 4900,
      setupFeeCents: 4900,
      includedMinutes: 100,
      overagePerMinuteCents: 75,
    });
  });

  it("creates Solo prices once and stays idempotent on a second sync", async () => {
    await prisma.plan.create({
      data: {
        code: "solo",
        name: "Solo",
        monthlyPriceCents: 4900,
        includedMinutes: 100,
        overagePerMinuteCents: 75,
        setupFeeCents: 4900,
        extraChangeFeeCents: 4900,
        recallMonthlyCents: 0,
        recallPerBookingCents: 0,
        sortOrder: 0,
      },
    });
    const billing = new MemoryBilling();
    await syncStripePrices(billing);
    const first = billing.creates.price;
    await syncStripePrices(billing);
    expect(billing.creates.price).toBe(first);
    const metered = await prisma.stripePrice.findFirst({ where: { lookupKey: overageLookupKey("solo", 100, 75) } });
    expect(metered?.amountCents).toBe(75);
  });

  it("takes a paid live-mode client live with one number and two emails", async () => {
    await setAutoGoLive(admin, true);
    const client = await readyClient();
    const harness = deps();
    const first = await runAutoGoLive(client.id, harness);
    expect(first.outcome).toBe("live");
    const runs = await prisma.provisioningRun.count({ where: { clientId: client.id } });
    expect(runs).toBe(1);
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.status).toBe("live");
    expect(updated.phoneE164).toBeTruthy();
    expect(harness.sent).toHaveLength(2);
    expect(harness.sent.map((row) => row.subject).sort()).toEqual([
      "Ava is live",
      "Harbor Heat went live automatically",
    ]);
    const again = await runAutoGoLive(client.id, harness);
    expect(again.outcome).toBe("already_live");
    expect(await prisma.provisioningRun.count({ where: { clientId: client.id } })).toBe(1);
    const log = await prisma.changeLog.findFirst({ where: { clientId: client.id, action: "auto_go_live.passed" } });
    expect(log?.actorUserId).toBe("system:auto-go-live");
  });

  it("holds when the setting is off, the payment is test mode, or the business is healthcare", async () => {
    const off = await readyClient({ stripeSubscriptionId: "sub_off" });
    const offResult = await runAutoGoLive(off.id, deps());
    expect(offResult.outcome).toBe("held");
    expect(offResult.checks.find((check) => check.id === "setting")?.reason).toMatch(/off/);

    await setAutoGoLive(admin, true);
    const testMode = await readyClient({
      name: "Test Mode Co",
      stripeLivemode: false,
      stripeSubscriptionId: "sub_test",
      portalOwnerEmail: "test@example.com",
      contactPhone: "+15555550111",
    });
    await prisma.user.updateMany({ where: { clientId: testMode.id }, data: { email: "test@example.com" } });
    const blocked = await runAutoGoLive(testMode.id, deps());
    expect(blocked.checks.find((check) => check.id === "paid")?.reason).toMatch(/test-mode/);
    const allowed = await runAutoGoLive(testMode.id, deps(okText(), true));
    expect(allowed.outcome).toBe("live");

    const clinic = await readyClient({
      name: "Clinic",
      industry: "dental",
      stripeSubscriptionId: "sub_clinic",
      portalOwnerEmail: "clinic@example.com",
      contactPhone: "+15555550122",
    });
    const held = await runAutoGoLive(clinic.id, deps());
    expect(held.checks.find((check) => check.id === "eligible")?.reason).toBe("healthcare");
    expect(await prisma.provisioningRun.count({ where: { clientId: clinic.id } })).toBe(0);
  });

  it("holds for unverified email, incomplete setup, a failed content check, a thrown model, the cap, and a duplicate owner", async () => {
    await setAutoGoLive(admin, true);
    const unverified = await readyClient({ stripeSubscriptionId: "sub_unverified", portalOwnerEmail: "unverified@example.com", contactPhone: "+15555550133" });
    await prisma.user.updateMany({ where: { clientId: unverified.id }, data: { emailVerified: false, email: "unverified@example.com" } });
    expect((await runAutoGoLive(unverified.id, deps())).checks.find((check) => check.id === "verified")?.pass).toBe(false);

    const incomplete = await readyClient({
      name: "Empty",
      stripeSubscriptionId: "sub_empty",
      weeklyHours: {},
      portalOwnerEmail: "empty@example.com",
      contactPhone: "+15555550144",
    });
    await prisma.knowledgeBase.updateMany({ where: { clientId: incomplete.id }, data: { services: "", faqs: "", hours: {} } });
    expect((await runAutoGoLive(incomplete.id, deps())).checks.find((check) => check.id === "complete")?.pass).toBe(false);

    const risky = await readyClient({ stripeSubscriptionId: "sub_risk", portalOwnerEmail: "risk@example.com", contactPhone: "+15555550155" });
    const content = await runAutoGoLive(risky.id, deps(okText(false, "gambling")));
    expect(content.checks.find((check) => check.id === "content")?.reason).toBe("gambling");

    const thrown = await readyClient({ stripeSubscriptionId: "sub_throw", portalOwnerEmail: "throw@example.com", contactPhone: "+15555550166" });
    const failClosed = await runAutoGoLive(thrown.id, deps({ complete: async () => { throw new Error("down"); } }));
    expect(failClosed.checks.find((check) => check.id === "content")?.reason).toBe("content check unavailable");

    const capped = await readyClient({ stripeSubscriptionId: "sub_cap", portalOwnerEmail: "cap@example.com", contactPhone: "+15555550177" });
    for (let i = 0; i < 15; i += 1) {
      await prisma.client.create({
        data: { name: `Live ${i}`, status: "live", autoGoLiveAt: new Date(), contactPhone: `+15555551${String(i).padStart(3, "0")}` },
      });
    }
    const cap = await runAutoGoLive(capped.id, deps());
    expect(cap.checks.find((check) => check.id === "cap")?.reason).toBe("daily cap reached");

    await readyClient({ portalOwnerEmail: "shared@example.com", contactPhone: "+15555550180" });
    const duplicate = await readyClient({ stripeSubscriptionId: "sub_dup", portalOwnerEmail: "shared@example.com", contactPhone: "+15555550188" });
    const dup = await runAutoGoLive(duplicate.id, deps());
    expect(dup.checks.find((check) => check.id === "duplicate")?.pass).toBe(false);
  });

  it("approves a hold into a live client and decline does not provision", async () => {
    const held = await readyClient({ stripeSubscriptionId: "sub_hold" });
    const harness = deps();
    expect((await runAutoGoLive(held.id, harness)).outcome).toBe("held");
    await setAutoGoLive(admin, true);
    const approved = await approveAutoGoLive(admin, held.id, harness);
    expect(approved.outcome).toBe("live");
    expect(await prisma.provisioningRun.count({ where: { clientId: held.id } })).toBe(1);

    const declined = await readyClient({
      stripeSubscriptionId: "sub_decline",
      portalOwnerEmail: "decline@example.com",
      contactPhone: "+15555550199",
    });
    await declineAutoGoLive(admin, declined.id);
    expect(await prisma.provisioningRun.count({ where: { clientId: declined.id } })).toBe(0);
    const log = await prisma.changeLog.findFirst({ where: { action: "auto_go_live.declined", clientId: declined.id } });
    expect(log?.actorUserId).toBe(admin.id);
  });

  it("pauses and resumes a live client with the admin reason", async () => {
    await setAutoGoLive(admin, true);
    const client = await readyClient();
    await runAutoGoLive(client.id, deps());
    const live = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    await pauseClientByAdmin(admin, client.id);
    const paused = await inboundCallPayload(live.phoneE164!);
    expect(paused.agent_override?.retell_llm?.begin_message).toMatch(/can't take your call/);
    const log = await prisma.changeLog.findFirst({ where: { clientId: client.id, action: "client.paused" } });
    expect(log?.after).toMatchObject({ reason: "paused by admin" });
    await resumeClientByAdmin(admin, client.id);
    const resumed = await inboundCallPayload(live.phoneE164!);
    expect(resumed.agent_override?.retell_llm?.begin_message ?? "").not.toMatch(/can't take your call/);
  });
});
