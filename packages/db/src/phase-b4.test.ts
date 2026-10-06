import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryBilling } from "@alinstra/providers";
import {
  approvePlanChangeRequest,
  applyStripeEvent,
  inboundCallPayload,
  ownerBillingOverview,
  pausePastDueClients,
  requestPlanChange,
  resetTestDatabase,
} from "./index";
import { prisma } from "./client";
import { seedPlans } from "./plans";

const admin = { id: "admin_b4", role: "admin" as const };

async function seedClient(name: string) {
  await seedPlans();
  const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
  return prisma.client.create({
    data: {
      name,
      timezone: "America/New_York",
      planId: plan.id,
      portalOwnerEmail: `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
      contactEmail: `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
      stripeCustomerId: `cus_${name}`,
      stripeSubscriptionId: `sub_${name}`,
      billingStatus: "paid",
      paidAt: new Date("2026-01-01T00:00:00.000Z"),
      phoneE164: `+1800555${String(Math.floor(Math.random() * 9000) + 1000)}`,
    },
  });
}

describe("Phase B Part 4 billing lifecycle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets pastDueSince on payment_failed and emails the owner", async () => {
    const client = await seedClient("PastDue");
    const now = new Date("2026-03-01T12:00:00.000Z");
    const result = await applyStripeEvent(
      {
        id: "evt_fail_b4",
        type: "invoice.payment_failed",
        data: { object: { customer: client.stripeCustomerId! } },
      },
      now,
    );
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.billingStatus).toBe("past_due");
    expect(updated.pastDueSince?.toISOString()).toBe(now.toISOString());
    expect(result.notify?.subject).toMatch(/Payment failed/);
    expect(result.ownerEmails?.[0]?.text).toMatch(/didn't go through/i);
    expect(result.ownerEmails?.[0]?.text).toMatch(/\/home\/billing/);

    const again = await applyStripeEvent(
      {
        id: "evt_fail_b4_2",
        type: "invoice.payment_failed",
        data: { object: { customer: client.stripeCustomerId! } },
      },
      new Date("2026-03-02T12:00:00.000Z"),
    );
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).pastDueSince?.toISOString()).toBe(now.toISOString());
    expect(again.ownerEmails?.[0]?.to).toBe(client.portalOwnerEmail);
  });

  it("resumes paused clients on invoice.paid", async () => {
    const client = await seedClient("Resume");
    await prisma.client.update({
      where: { id: client.id },
      data: { billingStatus: "paused", pastDueSince: new Date("2026-02-01T00:00:00.000Z") },
    });
    const result = await applyStripeEvent({
      id: "evt_paid_resume",
      type: "invoice.paid",
      data: { object: { customer: client.stripeCustomerId! } },
    });
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.billingStatus).toBe("paid");
    expect(updated.pastDueSince).toBeNull();
    expect(result.ownerEmails?.[0]?.subject).toMatch(/all set/i);
  });

  it("schedules and undoes cancel_at_period_end from subscription.updated", async () => {
    const client = await seedClient("Cancel");
    const periodEnd = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
    const periodStart = periodEnd - 30 * 24 * 60 * 60;
    await applyStripeEvent({
      id: "evt_sub_cancel",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: client.stripeSubscriptionId!,
          cancel_at_period_end: true,
          items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
        },
      },
    });
    const scheduled = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(scheduled.billingStatus).toBe("cancel_scheduled");
    expect(scheduled.serviceEndsAt?.getTime()).toBe(periodEnd * 1000);
    expect(scheduled.stripeCurrentPeriodEnd?.getTime()).toBe(periodEnd * 1000);

    await applyStripeEvent({
      id: "evt_sub_uncancel",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: client.stripeSubscriptionId!,
          cancel_at_period_end: false,
          items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
        },
      },
    });
    const undone = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(undone.billingStatus).toBe("paid");
    expect(undone.serviceEndsAt).toBeNull();
  });

  it("stores period bounds on subscription.created the same as updated", async () => {
    const client = await seedClient("CreatedPeriod");
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeCurrentPeriodStart: null, stripeCurrentPeriodEnd: null },
    });
    const periodEnd = Math.floor(Date.now() / 1000) + 25 * 24 * 60 * 60;
    const periodStart = periodEnd - 30 * 24 * 60 * 60;
    await applyStripeEvent({
      id: "evt_sub_created",
      type: "customer.subscription.created",
      data: {
        object: {
          id: client.stripeSubscriptionId!,
          cancel_at_period_end: false,
          items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
        },
      },
    });
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.stripeCurrentPeriodStart?.getTime()).toBe(periodStart * 1000);
    expect(updated.stripeCurrentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
  });

  it("fetches subscription period on checkout.session.completed when empty", async () => {
    await seedPlans();
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    const client = await prisma.client.create({
      data: {
        name: "CheckoutPeriod",
        planId: plan.id,
        billingStatus: "checkout_open",
        stripeCustomerId: "cus_checkout_period",
      },
    });
    const billing = new MemoryBilling();
    const subscriptionId = billing.subscriptionFor(client.id);
    const start = new Date("2026-10-01T00:00:00.000Z");
    const end = new Date("2026-10-31T00:00:00.000Z");
    billing.periodStart.set(subscriptionId, start);
    billing.periodEnd.set(subscriptionId, end);

    await applyStripeEvent(
      {
        id: "evt_checkout_period",
        type: "checkout.session.completed",
        data: {
          object: {
            payment_status: "paid",
            subscription: subscriptionId,
            metadata: { client_id: client.id },
          },
        },
      },
      new Date("2026-10-01T12:00:00.000Z"),
      { billing },
    );
    const paid = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(paid.billingStatus).toBe("paid");
    expect(paid.stripeCurrentPeriodStart?.toISOString()).toBe(start.toISOString());
    expect(paid.stripeCurrentPeriodEnd?.toISOString()).toBe(end.toISOString());
  });

  it("pauses clients whose pastDueSince is more than 7 days old", async () => {
    const client = await seedClient("PauseMe");
    const pastDueSince = new Date("2026-02-01T00:00:00.000Z");
    await prisma.client.update({
      where: { id: client.id },
      data: { billingStatus: "past_due", pastDueSince },
    });
    const now = new Date("2026-02-10T14:00:00.000Z");
    const report = await pausePastDueClients(now);
    expect(report.paused).toBe(1);
    expect(report.ownerEmails[0]?.subject).toMatch(/paused/i);
    expect(report.adminNotices[0]?.subject).toMatch(/Paused/);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("paused");
  });

  it("overrides inbound begin_message while paused and ends quickly", async () => {
    const client = await seedClient("PausedCall");
    await prisma.client.update({
      where: { id: client.id },
      data: { billingStatus: "paused", phoneE164: "+18005550123" },
    });
    const payload = await inboundCallPayload("+18005550123");
    expect(payload.agent_override?.retell_llm.begin_message).toBe(
      `Thanks for calling ${client.name}. We can't take your call right now. Please try again later.`,
    );
    expect(payload.agent_override?.agent?.max_call_duration_ms).toBe(12_000);
    expect(payload.agent_override?.agent?.end_call_after_silence_ms).toBe(3_000);
    expect(payload.agent_override?.retell_llm).not.toHaveProperty("general_prompt");
    expect(payload.agent_override?.retell_llm).not.toHaveProperty("general_tools");
    expect(payload.dynamic_variables.allowed_targets).toBe("");
  });

  it("requests and upgrades a plan through PlanChangeRequest", async () => {
    const client = await seedClient("Upgrade");
    const premium = await prisma.plan.findFirstOrThrow({ where: { code: "premium" } });
    const owner = { id: "owner_up", role: "client_owner" as const, clientId: client.id };
    const requested = await requestPlanChange(owner, premium.id);
    expect(requested.direction).toBe("upgrade");

    const billing = new MemoryBilling();
    billing.subscriptionItems.set(client.stripeSubscriptionId!, {
      recurringPriceId: "price_old",
      meteredPriceId: "price_old_m",
    });
    billing.periodEnd.set(client.stripeSubscriptionId!, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    billing.periodStart.set(client.stripeSubscriptionId!, new Date());

    const approved = await approvePlanChangeRequest(admin, requested.id, billing);
    expect(approved.status).toBe("applied");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).planId).toBe(premium.id);
    expect(billing.lastPriceUpdate?.prorationBehavior).toBe("create_prorations");
  });

  it("schedules downgrades and applies them when the period advances", async () => {
    const client = await seedClient("Downgrade");
    const starter = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    const solo = await prisma.plan.findFirstOrThrow({ where: { code: "solo" } });
    await prisma.client.update({ where: { id: client.id }, data: { planId: starter.id } });
    const owner = { id: "owner_dn", role: "client_owner" as const, clientId: client.id };
    const requested = await requestPlanChange(owner, solo.id);
    expect(requested.direction).toBe("downgrade");

    const billing = new MemoryBilling();
    billing.periodEnd.set(client.stripeSubscriptionId!, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    billing.periodStart.set(client.stripeSubscriptionId!, new Date());
    const approved = await approvePlanChangeRequest(admin, requested.id, billing);
    expect(approved.status).toBe("scheduled");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).pendingPlanId).toBe(solo.id);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).planId).toBe(starter.id);
    expect(billing.lastPriceUpdate?.prorationBehavior).toBe("none");

    const oldStart = Math.floor(Date.now() / 1000) - 40 * 24 * 60 * 60;
    const newStart = Math.floor(Date.now() / 1000);
    const newEnd = newStart + 30 * 24 * 60 * 60;
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeCurrentPeriodStart: new Date(oldStart * 1000) },
    });
    await applyStripeEvent({
      id: "evt_period_roll",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: client.stripeSubscriptionId!,
          cancel_at_period_end: false,
          items: { data: [{ current_period_start: newStart, current_period_end: newEnd }] },
        },
      },
    });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).planId).toBe(solo.id);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).pendingPlanId).toBeNull();
  });

  it("computes owner billing usage over the stored Stripe period", async () => {
    const client = await seedClient("Usage");
    const start = new Date("2026-03-01T00:00:00.000Z");
    const end = new Date("2026-04-01T00:00:00.000Z");
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeCurrentPeriodStart: start, stripeCurrentPeriodEnd: end },
    });
    const call = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_usage_1",
        callerMasked: "(423) ***-0001",
        startedAt: new Date("2026-03-10T12:00:00.000Z"),
        endedAt: new Date("2026-03-10T12:05:00.000Z"),
        durationSeconds: 300,
      },
    });
    await prisma.usageRecord.create({
      data: {
        clientId: client.id,
        callRecordId: call.id,
        retellCallId: "retell_usage_1",
        startedAt: call.startedAt!,
        endedAt: call.endedAt!,
        durationSeconds: 300,
        billableMinutes: 5,
        internal: false,
      },
    });
    const overview = await ownerBillingOverview({ role: "client_owner", clientId: client.id }, client.id);
    expect(overview.minutesUsed).toBe(5);
    expect(overview.includedMinutes).toBeGreaterThan(0);
    expect(overview.nextBillDate?.toISOString()).toBe(end.toISOString());
  });
});
