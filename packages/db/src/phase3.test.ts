import { MemoryBilling, MemoryVoice } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyQuickUpdate } from "./agent";
import { prisma } from "./client";
import { maskCaller, officeOpen, parseTransferTargets, plainCallerName } from "./domain";
import {
  advanceProvisioning,
  applyRetellCall,
  applyStripeEvent,
  callRecords,
  clientMessages,
  decideTransfer,
  endServiceNow,
  failProvisioning,
  recordTakenMessage,
  runDueTeardowns,
  scheduleChurn,
  startProvisioning,
  syncProvisionedAgent,
  type Phase3Deps,
} from "./provision";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_phase3", role: "admin" as const };
const openFriday = new Date("2026-10-02T19:00:00.000Z");
const closedSaturday = new Date("2026-10-03T15:00:00.000Z");

async function seedClient(options: { internal?: boolean; healthcare?: boolean; name?: string } = {}) {
  const plan = await prisma.plan.create({
    data: {
      code: `plan_${options.name ?? "north"}`,
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
      name: options.name ?? "North HVAC",
      status: "lead",
      industry: options.healthcare ? "dental" : "hvac",
      timezone: "America/New_York",
      wizardSubmittedAt: new Date(),
      planId: plan.id,
      internal: options.internal ?? false,
      contactEmail: "owner@example.com",
      weeklyHours: { fri: { start: "09:00", end: "17:00" } },
      compliance: { healthcareSensitive: Boolean(options.healthcare), healthcareTouched: true },
      features: { messageRecipients: "office@example.com", liveTransfer: true },
    },
  });
  await prisma.agentConfig.create({
    data: {
      clientId: client.id,
      version: 1,
      status: "active",
      promptText: "The time is {{current_time}}.",
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
  await prisma.transferTarget.create({ data: { clientId: client.id, label: "Desk", e164: "+14155550100" } });
  await prisma.user.create({
    data: { id: `owner_${client.id}`, name: "Owner", email: `${client.id}@example.com`, role: "client_owner", clientId: client.id },
  });
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

describe("phase 3 provisioning", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("retries a provisioning step without creating the Stripe customer twice", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    const billing = new MemoryBilling();
    await billing.createCustomer({ clientId: client.id, name: client.name, email: null, idempotencyKey: "already" });
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, deps(voice, billing));
    expect(billing.creates.customer).toBe(1);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored.stripeCustomerId).toContain("cus_");
    expect(stored.stripeCheckoutUrl).toContain("checkout.stripe.test");
    expect(stored.status).toBe("awaiting_payment");
    expect(voice.llms.get(stored.retellLlmId ?? "")?.prompt).toContain("{{current_time_America/New_York}}");
    expect(voice.llms.get(stored.retellLlmId ?? "")?.prompt).toContain("{{office_open}}");
    expect(voice.llms.get(stored.retellLlmId ?? "")?.tools.some((tool) => tool.transferTo === "+14155550100")).toBe(true);
    expect([...voice.numbers.values()][0]).toMatchObject({ tollFree: false, areaCode: 423 });
    expect(billing.lastCheckout?.successUrl).toBe("https://staging.alinstra.com/billing/thanks");
    const before = { ...voice.creates, customer: billing.creates.customer };
    await prisma.provisioningRun.updateMany({ where: { clientId: client.id }, data: { status: "failed", finishedAt: null } });
    await prisma.provisioningStep.updateMany({ where: { run: { clientId: client.id } }, data: { status: "pending" } });
    await advanceProvisioning(admin, client.id, deps(voice, billing));
    expect(billing.creates.customer).toBe(before.customer);
    expect(voice.creates.llm).toBe(before.llm);
    expect(voice.creates.agent).toBe(before.agent);
    expect(voice.creates.number).toBe(before.number);
  });

  it("refuses to provision a healthcare client", async () => {
    const client = await seedClient({ healthcare: true, name: "Clinic" });
    await expect(startProvisioning(admin, client.id)).rejects.toThrow(/Healthcare/);
  });

  it("syncs a new prompt and records a failure the admin can retry", async () => {
    const client = await seedClient({ internal: true, name: "Alinstra" });
    const voice = new MemoryVoice();
    const billing = new MemoryBilling();
    const used = deps(voice, billing);
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, used);
    expect(billing.creates.customer).toBe(0);
    const live = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(live.status).toBe("live");
    expect(live.agentSyncStatus).toBe("in_sync");
    await prisma.agentConfig.updateMany({ where: { clientId: client.id, status: "active" }, data: { promptText: "Updated {{current_time}}." } });
    await prisma.client.update({ where: { id: client.id }, data: { agentSyncStatus: "syncing", syncedConfigId: null } });
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    expect(voice.llms.get(live.retellLlmId ?? "")?.prompt).toContain("Updated {{current_time_America/New_York}}");
    voice.failSync = true;
    await prisma.client.update({ where: { id: client.id }, data: { agentSyncStatus: "syncing", syncedConfigId: null } });
    expect(await syncProvisionedAgent(client.id, used)).toBe("failed");
    const failed = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(failed.agentSyncStatus).toBe("failed");
    voice.failSync = false;
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
  });

  it("keeps service until the paid period ends, and end-now removes the agent", async () => {
    const client = await seedClient();
    const voice = new MemoryVoice();
    const billing = new MemoryBilling();
    const used = deps(voice, billing);
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, used);
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeSubscriptionId: billing.subscriptionFor(client.id), billingStatus: "paid", status: "live" },
    });
    await scheduleChurn(admin, client.id, used);
    const scheduled = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(scheduled.status).toBe("live");
    expect(scheduled.billingStatus).toBe("cancel_scheduled");
    expect(voice.numbers.size).toBe(1);
    expect((await runDueTeardowns(used, new Date(scheduled.serviceEndsAt!.getTime() + 1000))).completed).toBe(1);
    const ended = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(ended.status).toBe("churned");
    expect(ended.phoneE164).toBeNull();
    expect(ended.retellAgentId).toBeNull();
    expect(ended.retellLlmId).toBeNull();
    expect(voice.numbers.size).toBe(0);
    expect(voice.agents.size).toBe(0);
    expect(voice.llms.size).toBe(0);
    await endServiceNow(admin, client.id, used);

    const other = await seedClient({ name: "Immediate" });
    const voice2 = new MemoryVoice();
    const billing2 = new MemoryBilling();
    await startProvisioning(admin, other.id);
    await advanceProvisioning(admin, other.id, deps(voice2, billing2));
    voice2.missingDeletes.add((await prisma.client.findUniqueOrThrow({ where: { id: other.id } })).phoneE164 ?? "");
    await endServiceNow(admin, other.id, deps(voice2, billing2));
    expect((await prisma.client.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("churned");
  });

  it("stores a message for the office and a masked call, isolated by client", async () => {
    const client = await seedClient();
    const other = await seedClient({ name: "Other" });
    const saved = await recordTakenMessage(client.id, { callerName: "Pat", callbackNumber: "+15551111", message: "The furnace is out." }, null);
    expect(saved.recipients).toEqual(["office@example.com"]);
    expect(saved.sentence).toMatch(/message/i);
    await applyRetellCall({
      event: "call_ended",
      call: {
        call_id: "call_1",
        agent_id: "missing",
        to_number: "+15550000001",
        from_number: "+14155551212",
        start_timestamp: openFriday.getTime() - 60_000,
        end_timestamp: openFriday.getTime(),
        disconnection_reason: "user_hangup",
        transcript: "secret transcript",
      } as never,
    });
    await prisma.client.update({ where: { id: client.id }, data: { phoneE164: "+15550000001", retellAgentId: "agent_north" } });
    await applyRetellCall({
      event: "call_ended",
      call: {
        call_id: "call_2",
        agent_id: "agent_north",
        from_number: "+14155551212",
        start_timestamp: openFriday.getTime() - 30_000,
        end_timestamp: openFriday.getTime(),
        disconnection_reason: "user_hangup",
        transcript: "do not store",
      } as never,
    });
    const calls = await callRecords({ role: "client_owner", clientId: client.id }).list(client.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callerMasked).toBe(maskCaller("+14155551212"));
    expect(calls[0]?.endReason).toBe("user_hangup");
    expect(calls[0]?.durationSeconds).toBe(30);
    expect(JSON.stringify(calls[0])).not.toContain("do not store");
    const owner = { role: "client_owner" as const, clientId: other.id };
    expect(await clientMessages(owner).list(client.id)).toEqual([]);
    expect(await callRecords(owner).list(client.id)).toEqual([]);
    expect((await clientMessages({ role: "client_owner", clientId: client.id }).list(client.id)).map((row) => row.body)).toEqual(["The furnace is out."]);
  });

  it("transfers only to a saved number during business hours", async () => {
    const client = await seedClient();
    expect(officeOpen({ fri: { start: "09:00", end: "17:00" } }, "America/New_York", openFriday)).toBe(true);
    expect(officeOpen({ fri: { start: "09:00", end: "17:00" } }, "America/New_York", closedSaturday)).toBe(false);
    expect(await decideTransfer(client.id, { target: "desk" }, openFriday)).toEqual({ allowed: true, tool: "transfer_desk" });
    expect(await decideTransfer(client.id, { number: "4155550100" }, openFriday)).toEqual({ allowed: true, tool: "transfer_desk" });
    expect(await decideTransfer(client.id, { number: "+14155550999" }, openFriday)).toMatchObject({ allowed: false, reason: expect.stringMatching(/message/i) });
    expect(await decideTransfer(client.id, { target: "Desk" }, closedSaturday)).toMatchObject({ allowed: false, reason: expect.stringMatching(/message/i) });
  });

  it("flags a sync when an owner replaces transfer targets", async () => {
    const client = await seedClient({ internal: true, name: "Synced" });
    const voice = new MemoryVoice();
    const billing = new MemoryBilling();
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, deps(voice, billing));
    const result = await applyQuickUpdate(
      { id: `owner_${client.id}`, role: "client_owner", clientId: client.id },
      { kind: "transfers", text: "Cell, +14155550200" },
    );
    expect(result.sync).toBe(true);
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.agentSyncStatus).toBe("syncing");
    expect(await prisma.transferTarget.findMany({ where: { clientId: client.id } })).toMatchObject([{ e164: "+14155550200" }]);
  });

  it("queues a sync when an owner applies an hours update on a provisioned client", async () => {
    const client = await seedClient({ name: "Hours" });
    const voice = new MemoryVoice();
    const billing = new MemoryBilling();
    const used = deps(voice, billing);
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, used);
    await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "submitted", hours: "Mon 9:00-17:00" } });
    const result = await applyQuickUpdate(
      { id: `owner_${client.id}`, role: "client_owner", clientId: client.id },
      { kind: "hours", text: "Friday window is 09:00-17:00" },
    );
    expect(result.sync).toBe(true);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).agentSyncStatus).toBe("syncing");
    expect(await syncProvisionedAgent(client.id, used)).toBe("in_sync");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).agentSyncStatus).toBe("in_sync");
  });

  it("keeps a custom price off the shared plan lookup key", async () => {
    const client = await seedClient({ name: "Custom" });
    await prisma.client.update({ where: { id: client.id }, data: { overrideMonthlyPriceCents: 2500 } });
    const billing = new MemoryBilling();
    await startProvisioning(admin, client.id);
    await advanceProvisioning(admin, client.id, deps(new MemoryVoice(), billing));
    expect(billing.prices.get(`client_${client.id}_monthly`)?.amountCents).toBe(2500);
    expect([...billing.prices.keys()].some((key) => key.startsWith("plan_") && key.endsWith("_monthly"))).toBe(false);
  });

  it("records Stripe payments once and schedules teardown when Stripe cancels", async () => {
    const client = await seedClient({ name: "Billed" });
    await prisma.client.update({ where: { id: client.id }, data: { stripeCustomerId: "cus_billed", stripeSubscriptionId: "sub_billed" } });
    await applyStripeEvent({ id: "evt_unpaid", type: "checkout.session.completed", data: { object: { payment_status: "unpaid", metadata: { client_id: client.id } } } });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("none");
    await applyStripeEvent({ id: "evt_paid", type: "checkout.session.completed", data: { object: { payment_status: "paid", subscription: "sub_billed", metadata: { client_id: client.id } } } });
    await applyStripeEvent({ id: "evt_paid", type: "checkout.session.completed", data: { object: { payment_status: "paid", subscription: "sub_billed", metadata: { client_id: client.id } } } });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("paid");
    const failed = await applyStripeEvent({ id: "evt_fail", type: "invoice.payment_failed", data: { object: { customer: "cus_billed" } } });
    expect(failed.notify?.subject).toMatch(/Payment failed/);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("past_due");
    const canceled = await applyStripeEvent({ id: "evt_cancel", type: "customer.subscription.deleted", data: { object: { id: "sub_billed", ended_at: 1_900_000_000 } } });
    expect(canceled.notify?.subject).toMatch(/canceled/);
    const scheduled = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(scheduled.billingStatus).toBe("cancel_scheduled");
    expect(scheduled.serviceEndsAt?.toISOString()).toBe(new Date(1_900_000_000 * 1000).toISOString());
    await applyStripeEvent({ id: "evt_expired", type: "checkout.session.expired", data: { object: { metadata: { client_id: client.id } } } });
  });

  it("skips an impossible service end and does not stop on one failure", async () => {
    const client = await seedClient({ name: "Old" });
    await prisma.client.update({
      where: { id: client.id },
      data: { billingStatus: "cancel_scheduled", serviceEndsAt: new Date("1970-01-02T00:00:00.000Z"), paidAt: new Date(), status: "live" },
    });
    const sweep = await runDueTeardowns(deps(new MemoryVoice(), new MemoryBilling()));
    expect(sweep.skipped).toEqual([client.id]);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe("live");
    await startProvisioning(admin, client.id);
    await failProvisioning(client.id, "Missing RETELL_API_KEY");
    expect((await prisma.provisioningRun.findFirstOrThrow({ where: { clientId: client.id, kind: "provision" } })).status).toBe("failed");
  });

  it("rejects premium transfer numbers and strips control characters from a caller name", async () => {
    expect(() => parseTransferTargets("Premium, +19005550100")).toThrow(/US or Canada/);
    expect(() => parseTransferTargets("Info, +14159760100")).toThrow(/US or Canada/);
    expect(parseTransferTargets("Desk, +14155550100")).toEqual([{ label: "Desk", e164: "+14155550100" }]);
    const client = await seedClient({ name: "Named" });
    const saved = await recordTakenMessage(client.id, { callerName: "Pat\nBcc: evil", callbackNumber: "4155550100", message: "Call me" }, null);
    expect(plainCallerName("Pat\nBcc: evil")).toBe("Pat Bcc: evil");
    expect((await prisma.clientMessage.findFirstOrThrow({ where: { clientId: client.id } })).callerName).toBe("Pat Bcc: evil");
    expect(saved.sentence).toMatch(/message/i);
    await expect(prisma.client.create({ data: { name: "Twin", phoneE164: "+18005550100" } })).resolves.toBeTruthy();
    await expect(prisma.client.create({ data: { name: "Twin 2", phoneE164: "+18005550100" } })).rejects.toThrow();
  });
});
