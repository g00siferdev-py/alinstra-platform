import { MemoryBilling, MemoryVoice, METER_APP_SETTING_KEY, METER_EVENT_NAME, overageLookupKey } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { openCheckout, type Phase3Deps } from "./provision";
import { reportUsageToStripe } from "./report-usage";
import { resetTestDatabase } from "./reset-test-database";
import { syncStripePrices } from "./stripe-sync";
import { upsertUsageRecord } from "./usage";

async function seedPlan(code = "starter") {
  return prisma.plan.create({
    data: {
      code,
      name: code,
      monthlyPriceCents: 19900,
      includedMinutes: 300,
      overagePerMinuteCents: 35,
      setupFeeCents: 29900,
      extraChangeFeeCents: 4900,
      recallMonthlyCents: 0,
      recallPerBookingCents: 0,
      sortOrder: 1,
      active: true,
    },
  });
}

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

describe("Phase B Part 3 metering", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("syncStripePrices creates the meter, plan prices including Solo metered_overage, and stores AppSetting", async () => {
    await seedPlan("solo");
    await seedPlan("starter");
    const billing = new MemoryBilling();
    const result = await syncStripePrices(billing);
    expect(result.meterId).toBe(`mtr_${METER_EVENT_NAME}`);
    expect(result.plans).toBe(2);
    expect(billing.creates.meter).toBe(1);
    expect(billing.creates.price).toBeGreaterThanOrEqual(6); // monthly+setup+metered × 2

    const setting = await prisma.appSetting.findUniqueOrThrow({ where: { key: METER_APP_SETTING_KEY } });
    expect(setting.value).toMatchObject({ meterId: result.meterId, eventName: METER_EVENT_NAME });

    const soloMetered = await prisma.stripePrice.findFirst({
      where: { planCode: "solo", kind: "metered_overage" },
    });
    expect(soloMetered?.kind).toBe("metered_overage");
    expect(soloMetered?.lookupKey).toBe(overageLookupKey("solo", 300, 35));
    expect(soloMetered?.amountCents).toBe(35);

    // Idempotent second sync.
    const again = await syncStripePrices(billing);
    expect(again.meterId).toBe(result.meterId);
    expect(billing.creates.meter).toBe(1);
    expect(again.taxBehaviorUpdated).toBe(0);
    for (const row of billing.prices.values()) {
      expect(row.taxBehavior).toBe("exclusive");
      expect(row.taxCode).toBe("txcd_10103001");
    }
  });

  it("syncStripePrices patches unspecified tax_behavior to exclusive", async () => {
    await seedPlan("solo");
    const billing = new MemoryBilling();
    await syncStripePrices(billing);
    for (const row of billing.prices.values()) {
      row.taxBehavior = "unspecified";
    }
    const again = await syncStripePrices(billing);
    expect(again.taxBehaviorUpdated).toBeGreaterThan(0);
    for (const row of billing.prices.values()) {
      expect(row.taxBehavior).toBe("exclusive");
    }
  });

  it("openCheckout uses client_* metered lookup when overage overrides are set", async () => {
    const plan = await seedPlan("professional");
    const client = await prisma.client.create({
      data: {
        name: "Override Co",
        status: "lead",
        planId: plan.id,
        billingStatus: "none",
        setupFeeWaived: true,
        stripeCustomerId: "cus_override",
        overrideIncludedMinutes: 500,
        overrideOveragePerMinuteCents: 20,
      },
    });
    const billing = new MemoryBilling();
    await syncStripePrices(billing);
    await openCheckout(client.id, deps(billing));
    expect(billing.lastCheckout?.meteredPriceId).toContain("client_");
    expect(billing.lastCheckout?.meteredPriceId).toContain("overage_500_20");
  });

  it("reportUsageToStripe reports paid non-internal rows and applies positive-delta corrections", async () => {
    const plan = await seedPlan();
    const paid = await prisma.client.create({
      data: {
        name: "Paid Co",
        planId: plan.id,
        internal: false,
        paidAt: new Date("2026-09-01T00:00:00.000Z"),
        stripeCustomerId: "cus_paid",
        billingStatus: "paid",
      },
    });
    const internal = await prisma.client.create({
      data: {
        name: "Internal",
        planId: plan.id,
        internal: true,
        paidAt: new Date("2026-09-01T00:00:00.000Z"),
        stripeCustomerId: "cus_internal",
        billingStatus: "paid",
      },
    });
    const unpaid = await prisma.client.create({
      data: {
        name: "Unpaid",
        planId: plan.id,
        internal: false,
        stripeCustomerId: "cus_unpaid",
        billingStatus: "checkout_open",
      },
    });

    const callPaid = await prisma.callRecord.create({
      data: {
        clientId: paid.id,
        retellCallId: "retell_paid",
        startedAt: new Date("2026-10-01T12:00:00.000Z"),
        endedAt: new Date("2026-10-01T12:01:30.000Z"),
        durationSeconds: 90,
        callerMasked: "****1111",
      },
    });
    const callInternal = await prisma.callRecord.create({
      data: {
        clientId: internal.id,
        retellCallId: "retell_int",
        startedAt: new Date("2026-10-01T12:00:00.000Z"),
        endedAt: new Date("2026-10-01T12:00:40.000Z"),
        durationSeconds: 40,
        callerMasked: "****2222",
      },
    });
    const callUnpaid = await prisma.callRecord.create({
      data: {
        clientId: unpaid.id,
        retellCallId: "retell_unpaid",
        startedAt: new Date("2026-10-01T12:00:00.000Z"),
        endedAt: new Date("2026-10-01T12:00:50.000Z"),
        durationSeconds: 50,
        callerMasked: "****3333",
      },
    });

    await prisma.$transaction(async (tx) => {
      await upsertUsageRecord(tx, {
        clientId: paid.id,
        callRecordId: callPaid.id,
        retellCallId: callPaid.retellCallId,
        startedAt: callPaid.startedAt!,
        endedAt: callPaid.endedAt!,
        durationSeconds: 90,
        costCents: null,
        internal: false,
      });
      await upsertUsageRecord(tx, {
        clientId: internal.id,
        callRecordId: callInternal.id,
        retellCallId: callInternal.retellCallId,
        startedAt: callInternal.startedAt!,
        endedAt: callInternal.endedAt!,
        durationSeconds: 40,
        costCents: null,
        internal: true,
      });
      await upsertUsageRecord(tx, {
        clientId: unpaid.id,
        callRecordId: callUnpaid.id,
        retellCallId: callUnpaid.retellCallId,
        startedAt: callUnpaid.startedAt!,
        endedAt: callUnpaid.endedAt!,
        durationSeconds: 50,
        costCents: null,
        internal: false,
      });
    });

    const billing = new MemoryBilling();
    const first = await reportUsageToStripe({ billing });
    expect(first.reported).toBe(1);
    expect(first.corrected).toBe(0);
    expect(billing.creates.meterEvent).toBe(1);
    expect(billing.meterEvents[0]?.value).toBe(2);
    expect(billing.meterEvents[0]?.identifier).toBeTruthy();

    const usage = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: callPaid.id } });
    expect(usage.meterReportedAt).toBeTruthy();
    expect(usage.meterReportedMinutes).toBe(2);
    expect(usage.meterEventId).toBe(usage.id);

    // Duration grows after report → positive delta correction.
    await prisma.$transaction(async (tx) => {
      await upsertUsageRecord(tx, {
        clientId: paid.id,
        callRecordId: callPaid.id,
        retellCallId: callPaid.retellCallId,
        startedAt: callPaid.startedAt!,
        endedAt: new Date("2026-10-01T12:03:00.000Z"),
        durationSeconds: 180,
        costCents: null,
        internal: false,
      });
    });
    const updated = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: callPaid.id } });
    expect(updated.billableMinutes).toBe(3);
    expect(updated.meterReportedAt).toBeTruthy();
    expect(updated.meterReportedMinutes).toBe(2);

    const second = await reportUsageToStripe({ billing });
    expect(second.corrected).toBe(1);
    expect(billing.creates.meterEvent).toBe(2);
    expect(billing.meterEvents[1]?.value).toBe(1);
    expect(billing.meterEvents[1]?.identifier).toBe(`${usage.id}:corr:3`);

    const after = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: callPaid.id } });
    expect(after.meterReportedMinutes).toBe(3);
  });

  it("notifies admin after 24h of meter report failures", async () => {
    const plan = await seedPlan();
    const client = await prisma.client.create({
      data: {
        name: "Fail Co",
        planId: plan.id,
        paidAt: new Date("2026-09-01T00:00:00.000Z"),
        stripeCustomerId: "cus_fail",
        billingStatus: "paid",
      },
    });
    const call = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_fail",
        startedAt: new Date("2026-10-01T12:00:00.000Z"),
        endedAt: new Date("2026-10-01T12:01:00.000Z"),
        durationSeconds: 60,
        callerMasked: "****4444",
      },
    });
    await prisma.$transaction(async (tx) => {
      await upsertUsageRecord(tx, {
        clientId: client.id,
        callRecordId: call.id,
        retellCallId: call.retellCallId,
        startedAt: call.startedAt!,
        endedAt: call.endedAt!,
        durationSeconds: 60,
        costCents: null,
        internal: false,
      });
    });
    const usage = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: call.id } });
    await prisma.usageRecord.update({
      where: { id: usage.id },
      data: { meterReportFailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const notices: string[] = [];
    const billing = new MemoryBilling();
    billing.meterEventFailures = 1;
    const result = await reportUsageToStripe({
      billing,
      notifyAdmin: async (subject) => {
        notices.push(subject);
      },
    });
    expect(result.failed).toBe(1);
    expect(result.notified).toBe(1);
    expect(notices[0]).toMatch(/24h/);
  });

  it("skips too-old rows and still reports newer ones", async () => {
    const plan = await seedPlan();
    const now = new Date("2026-10-06T12:00:00.000Z");
    const paidAt = new Date("2026-09-01T00:00:00.000Z");
    const client = await prisma.client.create({
      data: {
        name: "Age Co",
        planId: plan.id,
        paidAt,
        stripeCustomerId: "cus_age",
        billingStatus: "paid",
      },
    });
    const oldEnded = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const newEnded = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oldCall = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_old",
        startedAt: oldEnded,
        endedAt: oldEnded,
        durationSeconds: 60,
        callerMasked: "****0001",
      },
    });
    const newCall = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_new",
        startedAt: newEnded,
        endedAt: newEnded,
        durationSeconds: 60,
        callerMasked: "****0002",
      },
    });
    await prisma.$transaction(async (tx) => {
      await upsertUsageRecord(tx, {
        clientId: client.id,
        callRecordId: oldCall.id,
        retellCallId: oldCall.retellCallId,
        startedAt: oldCall.startedAt!,
        endedAt: oldCall.endedAt!,
        durationSeconds: 60,
        costCents: null,
        internal: false,
      });
      await upsertUsageRecord(tx, {
        clientId: client.id,
        callRecordId: newCall.id,
        retellCallId: newCall.retellCallId,
        startedAt: newCall.startedAt!,
        endedAt: newCall.endedAt!,
        durationSeconds: 60,
        costCents: null,
        internal: false,
      });
    });

    const billing = new MemoryBilling();
    const result = await reportUsageToStripe({ billing, now });
    expect(result.reported).toBe(1);
    expect(billing.creates.meterEvent).toBe(1);
    expect(billing.meterEvents[0]?.identifier).toBe(
      (await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: newCall.id } })).id,
    );
    const oldUsage = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: oldCall.id } });
    expect(oldUsage.meterSkippedAt).toBeTruthy();
    expect(oldUsage.meterSkipReason).toBe("too_old");
    expect(oldUsage.meterReportedAt).toBeNull();
  });

  it("does not let a recently failing row block the next one", async () => {
    const plan = await seedPlan();
    const now = new Date("2026-10-06T12:00:00.000Z");
    const client = await prisma.client.create({
      data: {
        name: "Fail Queue Co",
        planId: plan.id,
        paidAt: new Date("2026-09-01T00:00:00.000Z"),
        stripeCustomerId: "cus_fail_queue",
        billingStatus: "paid",
      },
    });
    const firstEnded = new Date("2026-10-01T10:00:00.000Z");
    const secondEnded = new Date("2026-10-02T10:00:00.000Z");
    const firstCall = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_fail_first",
        startedAt: firstEnded,
        endedAt: firstEnded,
        durationSeconds: 60,
        callerMasked: "****1001",
      },
    });
    const secondCall = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_fail_second",
        startedAt: secondEnded,
        endedAt: secondEnded,
        durationSeconds: 120,
        callerMasked: "****1002",
      },
    });
    await prisma.$transaction(async (tx) => {
      await upsertUsageRecord(tx, {
        clientId: client.id,
        callRecordId: firstCall.id,
        retellCallId: firstCall.retellCallId,
        startedAt: firstCall.startedAt!,
        endedAt: firstCall.endedAt!,
        durationSeconds: 60,
        costCents: null,
        internal: false,
      });
      await upsertUsageRecord(tx, {
        clientId: client.id,
        callRecordId: secondCall.id,
        retellCallId: secondCall.retellCallId,
        startedAt: secondCall.startedAt!,
        endedAt: secondCall.endedAt!,
        durationSeconds: 120,
        costCents: null,
        internal: false,
      });
    });
    const firstUsage = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: firstCall.id } });
    await prisma.usageRecord.update({
      where: { id: firstUsage.id },
      data: { meterReportFailedAt: new Date(now.getTime() - 5 * 60 * 1000) },
    });

    const billing = new MemoryBilling();
    const result = await reportUsageToStripe({ billing, now });
    expect(result.reported).toBe(1);
    expect(billing.creates.meterEvent).toBe(1);
    expect(billing.meterEvents[0]?.identifier).toBe(
      (await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: secondCall.id } })).id,
    );
    expect((await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: firstCall.id } })).meterReportedAt).toBeNull();
  });
});
