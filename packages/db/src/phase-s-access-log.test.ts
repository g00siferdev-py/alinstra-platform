import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_ACTIONS,
  ACCESS_LOG_RETENTION_DAYS,
  accessLogs,
  purgeAccessLogs,
  recordAccess,
  SUPPORT_LABEL,
  type AccessEntry,
} from "./access-log";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";

const DAY = 86_400_000;

async function seed() {
  const clientA = await prisma.client.create({ data: { name: "Alpha Plumbing", status: "live", wizardSubmittedAt: new Date() } });
  const clientB = await prisma.client.create({ data: { name: "Bravo Dental", status: "live", wizardSubmittedAt: new Date() } });
  const user = (id: string, name: string, role: string, clientId: string | null) =>
    prisma.user.create({ data: { id, name, email: `${id}@example.com`, role, clientId } });
  const adminUser = await user("admin_1", "Daniel Admin", "admin", null);
  const ownerA = await user("owner_a", "Olivia Owner", "client_owner", clientA.id);
  const staffA = await user("staff_a", "Sam Staff", "client_staff", clientA.id);
  const ownerB = await user("owner_b", "Bruno Owner", "client_owner", clientB.id);
  return { clientA, clientB, adminUser, ownerA, staffA, ownerB };
}

function entry(overrides: Partial<AccessEntry> & Pick<AccessEntry, "clientId" | "actorUserId" | "actorRole">): AccessEntry {
  return { action: "call.transcript.view", entityType: "call_record", entityId: "call_1", ...overrides };
}

describe("access log (Phase S part 2)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes a row for each read action with ids, request metadata, and a count for list views", async () => {
    const { clientA, ownerA } = await seed();
    const longAgent = `Mozilla/5.0 ${"x".repeat(400)}`;
    for (const action of ACCESS_ACTIONS) {
      const written = await recordAccess(
        entry({
          clientId: clientA.id,
          actorUserId: ownerA.id,
          actorRole: "client_owner",
          action,
          entityType: action.startsWith("message") ? "client_message" : "call_record",
          entityId: `entity_${action}`,
          ip: "203.0.113.9",
          userAgent: longAgent,
          count: action === "message.list" ? 6 : null,
        }),
      );
      expect(written).toBe(true);
    }
    const rows = await prisma.accessLog.findMany({ orderBy: { at: "asc" } });
    expect(rows.map((row) => row.action).sort()).toEqual([...ACCESS_ACTIONS].sort());
    expect(rows.every((row) => row.clientId === clientA.id && row.actorUserId === ownerA.id && row.actorRole === "client_owner")).toBe(true);
    expect(rows.every((row) => row.ip === "203.0.113.9" && row.impersonating === false)).toBe(true);
    // User agent is truncated to 200 characters.
    expect(rows.every((row) => row.userAgent?.length === 200)).toBe(true);
    expect(rows.find((row) => row.action === "message.list")?.count).toBe(6);
    expect(rows.filter((row) => row.action !== "message.list").every((row) => row.count === null)).toBe(true);
  });

  it("is best-effort: a failed insert reports ids only and does not throw", async () => {
    const { clientA, ownerA } = await seed();
    const secret = "Caller Jane Doe +14235550198 asked about her bill";
    vi.spyOn(prisma.accessLog, "create").mockRejectedValue(new Error(`insert failed near ${secret}`));
    const reports: Array<{ error: unknown; ids: Record<string, unknown> }> = [];
    const written = await recordAccess(entry({ clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner", entityId: "call_9", userAgent: "UA" }), {
      onError: (error, ids) => reports.push({ error, ids: { ...ids } }),
    });
    expect(written).toBe(false);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.ids).toEqual({ actorUserId: ownerA.id, clientId: clientA.id, action: "call.transcript.view", entityType: "call_record", entityId: "call_9" });
    // The ids object itself never carries the user agent, IP, or any text from the database error.
    expect(JSON.stringify(reports[0]!.ids)).not.toContain("Jane");

    // A reporter that throws must not break the page either.
    await expect(
      recordAccess(entry({ clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner" }), {
        onError: () => {
          throw new Error("sentry down");
        },
      }),
    ).resolves.toBe(false);
  });

  it("skips the write when the dedupe says an equivalent row exists, and writes anyway if the dedupe itself fails", async () => {
    const { clientA, ownerA } = await seed();
    const base = entry({ clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner", action: "call.recording.stream" });
    expect(await recordAccess(base, { shouldWrite: async () => true })).toBe(true);
    expect(await recordAccess(base, { shouldWrite: async () => false })).toBe(false);
    expect(
      await recordAccess(base, {
        shouldWrite: async () => {
          throw new Error("redis down");
        },
      }),
    ).toBe(true);
    expect(await prisma.accessLog.count()).toBe(2);
  });

  it("owners see only their own client, admins as Alinstra support with no ids or network details, staff by name", async () => {
    const { clientA, clientB, adminUser, ownerA, staffA, ownerB } = await seed();
    await recordAccess(entry({ clientId: clientA.id, actorUserId: staffA.id, actorRole: "client_staff", entityId: "call_a1" }));
    await recordAccess(entry({ clientId: clientA.id, actorUserId: adminUser.id, actorRole: "admin", entityId: "call_a2", ip: "198.51.100.7", userAgent: "Admin Browser" }));
    await recordAccess(entry({ clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner", action: "message.list", entityType: "client", entityId: clientA.id, count: 3 }));
    await recordAccess(entry({ clientId: clientB.id, actorUserId: ownerB.id, actorRole: "client_owner", entityId: "call_b1" }));
    await recordAccess(entry({ clientId: clientB.id, actorUserId: adminUser.id, actorRole: "admin", entityId: "call_b2" }));

    const ownerView = await accessLogs({ role: "client_owner", clientId: clientA.id }).list();
    expect(ownerView.total).toBe(3);
    expect(ownerView.rows.every((row) => row.clientId === clientA.id)).toBe(true);
    expect(ownerView.rows.map((row) => row.entityId).sort()).toEqual([clientA.id, "call_a1", "call_a2"].sort());
    const labels = Object.fromEntries(ownerView.rows.map((row) => [row.entityId, row.actorLabel]));
    expect(labels.call_a1).toBe("Sam Staff");
    expect(labels.call_a2).toBe(SUPPORT_LABEL);
    expect(labels[clientA.id]).toBe("Olivia Owner");
    const adminRow = ownerView.rows.find((row) => row.entityId === "call_a2")!;
    expect(adminRow.actorUserId).toBe("");
    expect(adminRow.ip).toBeNull();
    expect(adminRow.userAgent).toBeNull();
    expect(JSON.stringify(ownerView)).not.toContain("Daniel Admin");
    expect(JSON.stringify(ownerView)).not.toContain("admin_1");
    expect(JSON.stringify(ownerView)).not.toContain("Bruno");

    // Asking for another client's rows through the filter changes nothing: the repository pins the tenant.
    const probing = await accessLogs({ role: "client_owner", clientId: clientA.id }).list({ clientId: clientB.id });
    expect(probing.rows.every((row) => row.clientId === clientA.id)).toBe(true);
    expect(probing.total).toBe(3);
    const other = await accessLogs({ role: "client_owner", clientId: clientB.id }).list();
    expect(other.rows.map((row) => row.entityId).sort()).toEqual(["call_b1", "call_b2"]);
  });

  it("refuses staff reads and non-admin export", async () => {
    const { clientA } = await seed();
    await recordAccess(entry({ clientId: clientA.id, actorUserId: "staff_a", actorRole: "client_staff" }));
    await expect(accessLogs({ role: "client_staff", clientId: clientA.id }).list()).rejects.toThrow(/owners and admins/);
    await expect(accessLogs({ role: "client_owner", clientId: clientA.id }).exportRows()).rejects.toThrow(/Only admins/);
    await expect(accessLogs({ role: "client_staff", clientId: clientA.id }).exportRows()).rejects.toThrow(/Only admins/);
  });

  it("admins filter by client, actor, action, and date range, page through results, and export", async () => {
    const { clientA, clientB, adminUser, ownerA, ownerB } = await seed();
    const now = Date.now();
    const at = (days: number) => new Date(now - days * DAY);
    const rows = [
      { clientId: clientA.id, actorUserId: adminUser.id, actorRole: "admin", action: "call.transcript.view", at: at(1), ip: "198.51.100.7" },
      { clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner", action: "call.recording.stream", at: at(5) },
      { clientId: clientB.id, actorUserId: ownerB.id, actorRole: "client_owner", action: "message.list", at: at(10), count: 4 },
      { clientId: clientB.id, actorUserId: adminUser.id, actorRole: "admin", action: "call.raw.view", at: at(20) },
    ];
    for (const row of rows) {
      await prisma.accessLog.create({ data: { entityType: "call_record", entityId: "e", ...row } });
    }
    const admin = accessLogs({ role: "admin" });

    expect((await admin.list()).total).toBe(4);
    expect((await admin.list({ clientId: clientA.id })).rows.map((row) => row.action)).toEqual(["call.transcript.view", "call.recording.stream"]);
    expect((await admin.list({ actor: "owner_b@example" })).rows.map((row) => row.action)).toEqual(["message.list"]);
    expect((await admin.list({ actor: adminUser.id })).total).toBe(2);
    expect((await admin.list({ actor: "nobody@nowhere" })).total).toBe(0);
    expect((await admin.list({ action: "call.raw.view" })).total).toBe(1);
    expect((await admin.list({ from: at(7), to: at(0) })).total).toBe(2);
    const paged = await admin.list({ pageSize: 3, page: 2 });
    expect(paged.rows).toHaveLength(1);
    expect(paged).toMatchObject({ total: 4, page: 2, pageSize: 3 });

    const first = (await admin.list({ clientId: clientA.id })).rows[0]!;
    expect(first).toMatchObject({ actorLabel: "Daniel Admin (admin_1@example.com)", clientName: "Alpha Plumbing", ip: "198.51.100.7", actorUserId: adminUser.id });

    // A client-scoped admin context (the Access history tab) cannot be steered to another client.
    const scoped = accessLogs({ role: "admin", clientId: clientB.id });
    expect((await scoped.list()).total).toBe(2);
    expect((await scoped.list({ clientId: clientA.id })).total).toBe(0);

    const exported = await admin.exportRows({ clientId: clientB.id });
    expect(exported.map((row) => row.action)).toEqual(["message.list", "call.raw.view"]);
  });

  it("purges rows older than 400 days and keeps the rest", async () => {
    const { clientA, ownerA } = await seed();
    const now = new Date("2026-10-06T07:00:00.000Z");
    const make = (label: string, ageMs: number) =>
      prisma.accessLog.create({ data: { clientId: clientA.id, actorUserId: ownerA.id, actorRole: "client_owner", action: "message.view", entityType: "client_message", entityId: label, at: new Date(now.getTime() - ageMs) } });
    await make("401_days", 401 * DAY);
    await make("400_days_and_a_second", 400 * DAY + 1000);
    await make("exactly_400_days", ACCESS_LOG_RETENTION_DAYS * DAY);
    await make("399_days", 399 * DAY);
    await make("today", 0);

    expect(await purgeAccessLogs(now)).toBe(2);
    const left = (await prisma.accessLog.findMany({ select: { entityId: true } })).map((row) => row.entityId).sort();
    expect(left).toEqual(["399_days", "exactly_400_days", "today"]);
    // Re-running removes nothing more.
    expect(await purgeAccessLogs(now)).toBe(0);
  });
});
