import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";
import { backfillUsageRecords, billableMinutesOf, usageRecords } from "./usage";
import type { TenantContext } from "./tenant";

async function seedPair() {
  const clientA = await prisma.client.create({ data: { name: "Client A", internal: false } });
  const clientB = await prisma.client.create({ data: { name: "Client B", internal: true } });
  const callA = await prisma.callRecord.create({
    data: {
      clientId: clientA.id,
      retellCallId: "retell_a1",
      startedAt: new Date("2026-10-01T12:00:00.000Z"),
      endedAt: new Date("2026-10-01T12:01:30.000Z"),
      durationSeconds: 90,
      callerMasked: "****1234",
      costCents: 12,
    },
  });
  const callB = await prisma.callRecord.create({
    data: {
      clientId: clientB.id,
      retellCallId: "retell_b1",
      startedAt: new Date("2026-10-01T13:00:00.000Z"),
      endedAt: new Date("2026-10-01T13:00:40.000Z"),
      durationSeconds: 40,
      callerMasked: "****9999",
    },
  });
  await prisma.usageRecord.create({
    data: {
      clientId: clientA.id,
      callRecordId: callA.id,
      retellCallId: callA.retellCallId,
      startedAt: callA.startedAt!,
      endedAt: callA.endedAt!,
      durationSeconds: 90,
      billableMinutes: 2,
      costCents: 12,
      internal: false,
    },
  });
  await prisma.usageRecord.create({
    data: {
      clientId: clientB.id,
      callRecordId: callB.id,
      retellCallId: callB.retellCallId,
      startedAt: callB.startedAt!,
      endedAt: callB.endedAt!,
      durationSeconds: 40,
      billableMinutes: 1,
      internal: true,
    },
  });
  return { clientA, clientB, callA, callB };
}

describe("billableMinutesOf", () => {
  it("ceils whole minutes the same way the portal does", () => {
    expect(billableMinutesOf(0)).toBe(0);
    expect(billableMinutesOf(1)).toBe(1);
    expect(billableMinutesOf(60)).toBe(1);
    expect(billableMinutesOf(61)).toBe(2);
    expect(billableMinutesOf(90)).toBe(2);
  });
});

describe("usageRecords isolation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("scopes owner and staff to their client and lets admin see all or filter", async () => {
    const { clientA, clientB } = await seedPair();
    const ownerA: TenantContext = { role: "client_owner", clientId: clientA.id };
    const staffB: TenantContext = { role: "client_staff", clientId: clientB.id };

    const listedA = await usageRecords(ownerA).list(clientA.id);
    expect(listedA).toHaveLength(1);
    expect(listedA[0]?.clientId).toBe(clientA.id);
    expect(listedA[0]?.retellCallId).toBe("retell_a1");
    expect(await usageRecords(ownerA).list(clientB.id)).toEqual([]);
    expect(await usageRecords(ownerA).sumMinutes(clientA.id, new Date("2026-10-01T00:00:00.000Z"))).toBe(2);
    expect(await usageRecords(ownerA).sumMinutes(clientB.id, new Date("2026-10-01T00:00:00.000Z"))).toBe(0);

    expect(await usageRecords(staffB).list(clientB.id)).toHaveLength(1);
    expect(await usageRecords(staffB).list(clientA.id)).toEqual([]);

    const adminAll = await usageRecords({ role: "admin" }).list(clientA.id);
    expect(adminAll).toHaveLength(1);
    const adminScoped = await usageRecords({ role: "admin", clientId: clientB.id }).list(clientA.id);
    expect(adminScoped).toEqual([]);
    expect(await usageRecords({ role: "admin", clientId: clientB.id }).list(clientB.id)).toHaveLength(1);
  });

  it("backfills missing rows idempotently and never invents duplicates", async () => {
    const client = await prisma.client.create({ data: { name: "Backfill Co" } });
    const ended = await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_bf1",
        startedAt: new Date("2026-09-01T10:00:00.000Z"),
        endedAt: new Date("2026-09-01T10:00:45.000Z"),
        durationSeconds: 45,
        callerMasked: "****0001",
        costCents: 5,
      },
    });
    await prisma.callRecord.create({
      data: {
        clientId: client.id,
        retellCallId: "retell_open",
        startedAt: new Date("2026-09-01T11:00:00.000Z"),
        endedAt: null,
        callerMasked: "****0002",
      },
    });

    const dry = await backfillUsageRecords({ dryRun: true });
    expect(dry).toMatchObject({ created: 1, skipped: 0, dryRun: true });
    expect(await prisma.usageRecord.count()).toBe(0);

    const first = await backfillUsageRecords({ dryRun: false });
    expect(first).toMatchObject({ created: 1, skipped: 0, dryRun: false });
    const row = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: ended.id } });
    expect(row).toMatchObject({ billableMinutes: 1, durationSeconds: 45, costCents: 5, retellCallId: "retell_bf1" });

    const second = await backfillUsageRecords({ dryRun: false });
    expect(second).toMatchObject({ created: 0, skipped: 1, dryRun: false });
    expect(await prisma.usageRecord.count()).toBe(1);
  });
});
