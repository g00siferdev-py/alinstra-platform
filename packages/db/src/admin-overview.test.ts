import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminOverview, listLiveCalls } from "./admin-overview";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_overview", role: "admin" as const };
const now = new Date("2026-10-05T15:00:00.000Z");

describe("adminOverview", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.user.create({
      data: {
        id: admin.id,
        name: "Admin",
        email: "admin-overview@example.com",
        emailVerified: true,
        role: "admin",
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists live calls started within 20 minutes and refuses non-admins", async () => {
    const plan = await prisma.plan.create({
      data: {
        code: "ov_plan",
        name: "Professional",
        monthlyPriceCents: 20000,
        includedMinutes: 1000,
        overagePerMinuteCents: 40,
        setupFeeCents: 0,
        extraChangeFeeCents: 4900,
        recallMonthlyCents: 0,
        recallPerBookingCents: 0,
        sortOrder: 1,
      },
    });
    const client = await prisma.client.create({
      data: {
        name: "Ridgeline Heating & Air",
        planId: plan.id,
        status: "active",
        timezone: "America/New_York",
      },
    });
    await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "live_1",
        startedAt: new Date(now.getTime() - 90_000),
        endedAt: null,
        callerMasked: "(423) •••-7710",
      },
    });
    await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "stale_1",
        startedAt: new Date(now.getTime() - 30 * 60_000),
        endedAt: null,
        callerMasked: "(423) •••-0000",
      },
    });

    const live = await listLiveCalls(admin, now);
    expect(live).toHaveLength(1);
    expect(live[0]?.clientName).toBe("Ridgeline Heating & Air");

    const overview = await adminOverview(admin, now);
    expect(overview.stats.callsToday).toBe(2);
    expect(overview.clients[0]?.status).toBe("on_a_call");
    expect(overview.startInterviewHref).toBeTruthy();

    await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "ended_1",
        startedAt: new Date(now.getFullYear(), now.getMonth(), 2, 12, 0, 0),
        endedAt: new Date(now.getFullYear(), now.getMonth(), 2, 12, 1, 30),
        durationSeconds: 90,
        callerMasked: "(423) •••-1111",
      },
    });
    const ended = await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "ended_1" } });
    await prisma.usageRecord.create({
      data: {
        clientId: client.id,
        callRecordId: ended.id,
        retellCallId: "ended_1",
        startedAt: ended.startedAt!,
        endedAt: ended.endedAt!,
        durationSeconds: 90,
        billableMinutes: 2,
        internal: false,
      },
    });
    const withMinutes = await adminOverview(admin, now);
    expect(withMinutes.stats.minutesThisMonth).toBe(2);
    expect(withMinutes.clients[0]?.minutesUsed).toBe(2);

    await expect(listLiveCalls({ id: "x", role: "client_owner", clientId: client.id }, now)).rejects.toThrow(/admin/i);
  });
});
