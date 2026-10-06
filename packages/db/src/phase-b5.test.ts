import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminBusinessReport,
  buildBusiestTimes,
  grossMarginOf,
  lastFullYearMonth,
  ownerMonthlyReport,
  parseYearMonth,
  resetTestDatabase,
  sendMonthlyReportEmails,
  setMonthlyReportEmail,
  yearMonthRange,
} from "./index";
import { prisma } from "./client";
import { seedPlans } from "./plans";

const admin = { id: "admin_b5", role: "admin" as const };

async function seedClient(name: string, opts: { internal?: boolean; timezone?: string } = {}) {
  await seedPlans();
  const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
  return prisma.client.create({
    data: {
      name,
      timezone: opts.timezone ?? "America/New_York",
      planId: plan.id,
      internal: opts.internal ?? false,
      portalOwnerEmail: `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
      weeklyHours: { mon: { start: "09:00", end: "17:00" }, tue: { start: "09:00", end: "17:00" } },
      billingStatus: "paid",
    },
  });
}

async function addCall(
  clientId: string,
  input: {
    startedAt: Date;
    durationSeconds: number;
    outcome?: string;
    flags?: unknown;
    costCents?: number;
    billableMinutes?: number;
  },
) {
  const endedAt = new Date(input.startedAt.getTime() + input.durationSeconds * 1000);
  const retellCallId = `retell_${clientId}_${input.startedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const call = await prisma.callRecord.create({
    data: {
      clientId,
      retellCallId,
      startedAt: input.startedAt,
      endedAt,
      durationSeconds: input.durationSeconds,
      callerMasked: "***1234",
      outcome: input.outcome ?? "message_taken",
      flags: input.flags ?? [],
      costCents: input.costCents ?? 12,
    },
  });
  await prisma.usageRecord.create({
    data: {
      clientId,
      callRecordId: call.id,
      retellCallId,
      startedAt: input.startedAt,
      endedAt,
      durationSeconds: input.durationSeconds,
      billableMinutes: input.billableMinutes ?? Math.max(1, Math.ceil(input.durationSeconds / 60)),
      costCents: input.costCents ?? 12,
      internal: false,
    },
  });
  return call;
}

describe("Phase B Part 5 reports", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("parses year-month and defaults to the last full calendar month", () => {
    expect(parseYearMonth("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseYearMonth("bad")).toBeNull();
    // 2026-10-06 Eastern → last full month September 2026
    expect(lastFullYearMonth("America/New_York", new Date("2026-10-06T15:00:00.000Z"))).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it("computes owner metrics from CallRecord metadata and UsageRecord minutes", async () => {
    const client = await seedClient("OwnerReport");
    const { start } = yearMonthRange(client.timezone, { year: 2026, month: 9 });
    // Tuesday 2026-09-01 14:00 ET is open; Tuesday 20:00 ET is after hours.
    const openCall = new Date(start.getTime() + 14 * 60 * 60 * 1000);
    const afterHours = new Date(start.getTime() + 20 * 60 * 60 * 1000);
    await addCall(client.id, {
      startedAt: openCall,
      durationSeconds: 120,
      outcome: "booked",
      flags: [{ type: "negative_sentiment" }],
      billableMinutes: 2,
      costCents: 20,
    });
    await addCall(client.id, {
      startedAt: afterHours,
      durationSeconds: 60,
      outcome: "transferred",
      billableMinutes: 1,
      costCents: 10,
    });
    await prisma.clientMessage.create({
      data: { clientId: client.id, callbackMasked: "***0198", createdAt: openCall },
    });

    const owner = { id: "owner_b5", role: "client_owner" as const, clientId: client.id };
    const report = await ownerMonthlyReport(owner, client.id, { year: 2026, month: 9 });
    expect(report.callsAnswered).toBe(2);
    expect(report.afterHoursCalls).toBe(1);
    expect(report.messagesTaken).toBe(1);
    expect(report.appointmentRequests).toBe(1);
    expect(report.appointmentRequestsNote).toMatch(/booked outcome/i);
    expect(report.transfers).toBe(1);
    expect(report.minutesUsed).toBe(3);
    expect(report.includedMinutes).toBe(300);
    expect(report.averageCallLengthSeconds).toBe(90);
    expect(report.flaggedCalls).toBe(1);
    expect(report.busiestTimes.length).toBeGreaterThan(0);
  });

  it("builds busiest-times cells and gross margin from integer cents", () => {
    const cells = buildBusiestTimes(
      [
        { startedAt: new Date("2026-09-01T18:00:00.000Z") },
        { startedAt: new Date("2026-09-01T18:30:00.000Z") },
        { startedAt: null },
      ],
      "America/New_York",
    );
    expect(cells[0]?.count).toBe(2);
    expect(grossMarginOf({ monthlyPriceCents: 19900, overageCents: 100, retellCostCents: 500 })).toEqual({
      revenueCents: 20000,
      grossMarginCents: 19500,
      grossMarginPercent: 97.5,
    });
  });

  it("skips internal clients and opted-out owners for monthly emails", async () => {
    const billed = await seedClient("EmailYes");
    const optedOut = await seedClient("EmailNo");
    const internal = await seedClient("Internal", { internal: true });
    await setMonthlyReportEmail(admin, { clientId: optedOut.id, enabled: false });

    const { start } = yearMonthRange("America/New_York", { year: 2026, month: 9 });
    const callAt = new Date(start.getTime() + 12 * 60 * 60 * 1000);
    await addCall(billed.id, { startedAt: callAt, durationSeconds: 30, billableMinutes: 1 });
    await addCall(optedOut.id, { startedAt: callAt, durationSeconds: 30, billableMinutes: 1 });
    await addCall(internal.id, { startedAt: callAt, durationSeconds: 30, billableMinutes: 1 });

    const result = await sendMonthlyReportEmails(new Date("2026-10-01T13:00:00.000Z"));
    expect(result.sent).toBe(1);
    expect(result.ownerEmails[0]?.to).toBe(billed.portalOwnerEmail);
    expect(result.ownerEmails[0]?.text).toMatch(/Calls answered: 1/);
    expect(result.ownerEmails[0]?.text).not.toMatch(/caller|message body|\+\d/i);
    expect(result.ownerEmails[0]?.text).toMatch(/\/home\/reports/);
  });

  it("lets the owner toggle monthly report email", async () => {
    const client = await seedClient("Toggle");
    const owner = { id: "owner_toggle", role: "client_owner" as const, clientId: client.id };
    await setMonthlyReportEmail(owner, { clientId: client.id, enabled: false });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).monthlyReportEmail).toBe(false);
  });

  it("builds an admin business report with margin and an internal row", async () => {
    const billed = await seedClient("AdminBilled");
    const internal = await seedClient("AdminInternal", { internal: true });
    await prisma.client.update({
      where: { id: billed.id },
      data: { overrideMonthlyPriceCents: 15000 },
    });
    const { start } = yearMonthRange("America/New_York", { year: 2026, month: 9 });
    const callAt = new Date(start.getTime() + 12 * 60 * 60 * 1000);
    await addCall(billed.id, { startedAt: callAt, durationSeconds: 600, billableMinutes: 350, costCents: 80 });
    await addCall(internal.id, { startedAt: callAt, durationSeconds: 60, billableMinutes: 1, costCents: 5 });

    const report = await adminBusinessReport(admin, { year: 2026, month: 9 });
    expect(report.revenueDisclaimer).toMatch(/Estimated/);
    const row = report.clients.find((r) => r.clientId === billed.id);
    expect(row?.monthlyPriceCents).toBe(15000);
    expect(row?.minutesUsed).toBe(350);
    expect(row?.overageMinutes).toBe(50);
    expect(row?.retellCostCents).toBe(80);
    expect(row?.grossMarginCents).toBe(15000 + 50 * 35 - 80);
    const internalRow = report.internal.find((r) => r.clientId === internal.id);
    expect(internalRow?.monthlyPriceCents).toBe(0);
    expect(internalRow?.retellCostCents).toBe(5);
  });
});
