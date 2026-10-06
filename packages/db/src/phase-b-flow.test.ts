/**
 * Phase B Part 6 verify: full self-serve billing flow against MemoryBilling.
 * Covers signup → checkout → paid → interview → submit gate → usage meter →
 * past_due/pause/inbound → resume → cancel_scheduled.
 */
import { MemoryBilling, MemoryVoice } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeInterviewForClient,
  applyFoundingWaiverAtCheckout,
  applyRetellCall,
  applyStripeEvent,
  attachSelfServeSignup,
  createSelfServeClient,
  ensureSelfServeCheckout,
  inboundCallPayload,
  openCheckout,
  pausePastDueClients,
  reportUsageToStripe,
  seedPlans,
  submitWizard,
  syncStripePrices,
  type Phase3Deps,
} from "./index";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";

function deps(billing: MemoryBilling): Phase3Deps {
  return {
    voice: new MemoryVoice(),
    billing,
    appUrl: "https://staging.alinstra.com",
    danielNumber: null,
    danielEmail: "daniel@alinstra.com",
    defaultAreaCode: "423",
    defaultTollFree: false,
  };
}

function checkoutLineItemCount(billing: MemoryBilling): number {
  const last = billing.lastCheckout;
  if (!last) return 0;
  return 1 + (last.setupPriceId ? 1 : 0) + (last.meteredPriceId ? 1 : 0);
}

function wizardPayload(planId: string, email: string, businessName: string) {
  return {
    version: 1 as const,
    business: {
      name: businessName,
      industry: "hvac",
      contactName: "Flow Owner",
      contactEmail: email,
      timezone: "America/New_York",
    },
    plan: { planId, setupFeeWaived: false },
    portalOwnerEmail: email,
    compliance: { aiDisclosure: true, recordingNotice: true },
    knowledge: {
      hours: "Mon-Fri 9:00-17:00",
      services: "Repairs",
      faqs: "Where are you?",
      policies: "No walk-ins",
      staff: "Owner",
    },
  };
}

describe("Phase B full flow (MemoryBilling)", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs signup through cancel_scheduled against fake billing", async () => {
    await seedPlans();
    const solo = await prisma.plan.findFirstOrThrow({ where: { code: "solo" } });
    const starter = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    const billing = new MemoryBilling();
    await syncStripePrices(billing);

    // --- 1. signup ---
    const email = "flow-owner@example.com";
    const { client, plan } = await createSelfServeClient({
      businessName: "Flow HVAC",
      ownerName: "Flow Owner",
      email,
      mobilePhone: "+14255550100",
      planId: solo.id,
    });
    const owner = await prisma.user.create({
      data: {
        id: "owner_b_flow",
        name: "Flow Owner",
        email,
        emailVerified: false,
        role: "client_owner",
        clientId: client.id,
      },
    });
    await attachSelfServeSignup({
      clientId: client.id,
      ownerUserId: owner.id,
      businessName: "Flow HVAC",
      ownerName: "Flow Owner",
      email,
      mobilePhone: "+14255550100",
      planId: plan.id,
      planCode: plan.code,
    });
    expect(client.selfServe).toBe(true);
    expect(client.billingStatus).toBe("none");
    expect(await prisma.wizardDraft.findFirst({ where: { clientId: client.id } })).toBeTruthy();

    // --- 2. checkout: 3 line items (monthly + metered + setup); 2 when waiver applies ---
    const session = await ensureSelfServeCheckout(client.id, deps(billing));
    expect(session.url).toContain("checkout.stripe.test");
    expect(checkoutLineItemCount(billing)).toBe(3);
    expect(billing.lastCheckout?.setupPriceId).toBeTruthy();
    expect(billing.lastCheckout?.meteredPriceId).toBeTruthy();
    expect(billing.lastCheckout?.recurringPriceId).toBeTruthy();

    const waivedClient = await prisma.client.create({
      data: {
        name: "Waived Co",
        status: "lead",
        planId: starter.id,
        billingStatus: "none",
        selfServe: true,
        contactEmail: "waived@example.com",
        stripeCustomerId: "cus_waived_flow",
      },
    });
    expect(await applyFoundingWaiverAtCheckout(waivedClient.id, starter.code)).toBe(true);
    await openCheckout(waivedClient.id, deps(billing));
    expect(checkoutLineItemCount(billing)).toBe(2);
    expect(billing.lastCheckout?.setupPriceId).toBeNull();

    // --- 3. checkout.session.completed → paid ---
    const paidAt = new Date("2026-03-01T12:00:00.000Z");
    const customerId = (await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).stripeCustomerId!;
    await applyStripeEvent(
      {
        id: "evt_flow_paid",
        type: "checkout.session.completed",
        data: {
          object: {
            payment_status: "paid",
            subscription: billing.subscriptionFor(client.id),
            metadata: { client_id: client.id },
          },
        },
      },
      paidAt,
    );
    const afterPay = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(afterPay.billingStatus).toBe("paid");
    expect(afterPay.paidAt?.toISOString()).toBe(paidAt.toISOString());
    expect(afterPay.stripeSubscriptionId).toBe(billing.subscriptionFor(client.id));

    // --- 4. interview reachable ---
    const ownerActor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    const interview = await activeInterviewForClient(ownerActor, client.id);
    expect(interview).toBeNull(); // none started yet, but access is allowed

    // --- 5. submit blocked until email verified ---
    const draft = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id, discardedAt: null } });
    const payload = wizardPayload(plan.id, email, "Flow HVAC");
    await prisma.wizardDraft.update({
      where: { id: draft.id },
      data: { payload, currentStep: 11 },
    });
    const refreshed = await prisma.wizardDraft.findUniqueOrThrow({ where: { id: draft.id } });
    await expect(
      submitWizard(ownerActor, {
        clientId: client.id,
        payload,
        updatedAt: refreshed.updatedAt.toISOString(),
      }),
    ).rejects.toThrow(/Confirm your email to submit/);

    // --- 6. call ends → UsageRecord → meter event reported once ---
    const phone = "+15550001999";
    const agentId = "agent_flow";
    await prisma.client.update({
      where: { id: client.id },
      data: { phoneE164: phone, retellAgentId: agentId, status: "live" },
    });
    const startMs = Date.parse("2026-03-05T15:00:00.000Z");
    await applyRetellCall({
      event: "call_ended",
      call: {
        call_id: "call_flow_1",
        agent_id: agentId,
        from_number: "+14155551212",
        to_number: phone,
        start_timestamp: startMs,
        end_timestamp: startMs + 90_000,
        duration_ms: 90_000,
        disconnection_reason: "user_hangup",
        transcript: "short call",
      } as never,
    });
    const usage = await prisma.usageRecord.findFirstOrThrow({ where: { clientId: client.id } });
    expect(usage.billableMinutes).toBe(2);
    expect(usage.meterReportedAt).toBeNull();

    const firstReport = await reportUsageToStripe({ billing });
    expect(firstReport.reported).toBe(1);
    expect(billing.creates.meterEvent).toBe(1);
    expect(billing.meterEvents[0]?.identifier).toBe(usage.id);
    expect(billing.meterEvents[0]?.value).toBe(2);

    const secondReport = await reportUsageToStripe({ billing });
    expect(secondReport.reported).toBe(0);
    expect(billing.creates.meterEvent).toBe(1);

    // --- 7. invoice.payment_failed → past_due → 7 days later paused → inbound paused message ---
    const failAt = new Date("2026-03-10T12:00:00.000Z");
    await applyStripeEvent(
      {
        id: "evt_flow_fail",
        type: "invoice.payment_failed",
        data: { object: { customer: customerId } },
      },
      failAt,
    );
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("past_due");

    const pauseAt = new Date(failAt.getTime() + 8 * 24 * 60 * 60 * 1000);
    const paused = await pausePastDueClients(pauseAt);
    expect(paused.paused).toBeGreaterThanOrEqual(1);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("paused");

    const inbound = await inboundCallPayload(phone);
    expect(inbound.agent_override?.retell_llm.begin_message).toBe(
      "Thanks for calling Flow HVAC. We can't take your call right now. Please try again later.",
    );
    expect(inbound.agent_override?.agent?.max_call_duration_ms).toBe(15_000);

    // --- 8. invoice.paid → resumed ---
    await applyStripeEvent({
      id: "evt_flow_resume",
      type: "invoice.paid",
      data: { object: { customer: customerId } },
    });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("paid");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).pastDueSince).toBeNull();

    // --- 9. cancel at period end → cancel_scheduled ---
    const periodEnd = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
    const periodStart = periodEnd - 30 * 24 * 60 * 60;
    const subId = (await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).stripeSubscriptionId!;
    await applyStripeEvent({
      id: "evt_flow_cancel",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subId,
          cancel_at_period_end: true,
          items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
        },
      },
    });
    const canceled = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(canceled.billingStatus).toBe("cancel_scheduled");
    expect(canceled.serviceEndsAt?.getTime()).toBe(periodEnd * 1000);
  });
});
