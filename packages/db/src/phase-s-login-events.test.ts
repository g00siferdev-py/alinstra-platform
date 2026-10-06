import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import {
  countRecentBulkReads,
  describeBrowser,
  ipPrefixOf,
  LOGIN_EVENT_RETENTION_DAYS,
  maskIpPrefix,
  NEW_NETWORK_WINDOW_DAYS,
  purgeLoginEvents,
  recordLoginEvent,
} from "./login-events";
import { resetTestDatabase } from "./reset-test-database";

const DAY = 86_400_000;
const NOW = new Date("2026-10-06T12:00:00Z");

async function seedUser() {
  return prisma.user.create({ data: { id: "owner_1", name: "Olivia Owner", email: "owner@example.com", role: "client_owner" } });
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe("login event helpers", () => {
  it("derives /24 for IPv4 and /48 for IPv6, and nothing for non-addresses", () => {
    expect(ipPrefixOf("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefixOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipPrefixOf("2001:0DB8:ABCD:0012:0000:0000:0000:0001")).toBe("2001:db8:abcd::/48");
    expect(ipPrefixOf("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
    expect(ipPrefixOf("::1")).toBe("0:0:0::/48");
    expect(ipPrefixOf("local")).toBeNull();
    expect(ipPrefixOf("999.1.1.1")).toBeNull();
    expect(ipPrefixOf("")).toBeNull();
    expect(ipPrefixOf(null)).toBeNull();
  });

  it("masks a prefix down to the first two IPv4 octets or IPv6 groups", () => {
    expect(maskIpPrefix("203.0.113.0/24")).toBe("203.0.x.x");
    expect(maskIpPrefix("2001:db8:abcd::/48")).toBe("2001:db8:x");
    expect(maskIpPrefix(null)).toBe("unknown");
    expect(maskIpPrefix("203.0.113.0/24")).not.toContain("113");
  });

  it("describes a browser without versions or the raw user agent", () => {
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Edge on Windows");
    expect(describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(describeBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe("Firefox on Linux");
    expect(describeBrowser(null)).toBe("an unknown browser");
  });
});

describe("LoginEvent (Phase S part 3)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes every attempt with a normalized email, the prefix, and a truncated user agent", async () => {
    const user = await seedUser();
    const longAgent = `Mozilla/5.0 ${"x".repeat(400)}`;
    const ok = await recordLoginEvent({ userId: user.id, email: "  Owner@Example.com ", success: true, ip: "203.0.113.9", userAgent: longAgent }, { now: NOW });
    const bad = await recordLoginEvent({ userId: null, email: "nobody@example.com", success: false, ip: "2001:db8:abcd:12::1", userAgent: null }, { now: NOW });
    expect(ok.written && bad.written).toBe(true);

    const rows = await prisma.loginEvent.findMany({ orderBy: { email: "asc" } });
    expect(rows).toHaveLength(2);
    const success = rows.find((row) => row.success)!;
    expect(success).toMatchObject({ userId: "owner_1", email: "owner@example.com", ip: "203.0.113.9", ipPrefix: "203.0.113.0/24" });
    expect(success.userAgent).toHaveLength(200);
    const failure = rows.find((row) => !row.success)!;
    expect(failure).toMatchObject({ userId: null, email: "nobody@example.com", ipPrefix: "2001:db8:abcd::/48", userAgent: null });
  });

  it("does not store a placeholder address as an IP", async () => {
    await recordLoginEvent({ userId: null, email: "a@example.com", success: false, ip: "local" }, { now: NOW });
    const row = await prisma.loginEvent.findFirstOrThrow();
    expect(row.ip).toBeNull();
    expect(row.ipPrefix).toBeNull();
  });

  it("skips the alert on a user's very first successful sign-in", async () => {
    const user = await seedUser();
    // Failed attempts before it do not make it a second login.
    await recordLoginEvent({ userId: user.id, email: user.email, success: false, ip: "198.51.100.1" }, { now: daysAgo(1) });
    const first = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: NOW });
    expect(first.newNetwork).toBe(false);
  });

  it("flags a successful sign-in from a prefix not seen in 90 days, but not one seen within it", async () => {
    const user = await seedUser();
    await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: daysAgo(30) });

    const sameNetwork = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.200" }, { now: NOW });
    expect(sameNetwork.newNetwork).toBe(false);

    const elsewhere = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "198.51.100.4" }, { now: NOW });
    expect(elsewhere.newNetwork).toBe(true);
    expect(elsewhere.ipPrefix).toBe("198.51.100.0/24");

    // Now that it has signed in successfully, the same network is familiar.
    const again = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "198.51.100.77" }, { now: NOW });
    expect(again.newNetwork).toBe(false);
  });

  it("treats a prefix last used more than 90 days ago as new", async () => {
    const user = await seedUser();
    await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: daysAgo(NEW_NETWORK_WINDOW_DAYS + 5) });
    const result = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: NOW });
    expect(result.newNetwork).toBe(true);
  });

  it("does not count failed attempts as having seen a network, and never flags a failure", async () => {
    const user = await seedUser();
    await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: daysAgo(10) });
    const failed = await recordLoginEvent({ userId: user.id, email: user.email, success: false, ip: "198.51.100.4" }, { now: daysAgo(5) });
    expect(failed.newNetwork).toBe(false);
    const success = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "198.51.100.4" }, { now: NOW });
    expect(success.newNetwork).toBe(true);
  });

  it("is per user: another user's history does not make a network familiar", async () => {
    const user = await seedUser();
    const other = await prisma.user.create({ data: { id: "owner_2", name: "Other", email: "other@example.com", role: "client_owner" } });
    await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: daysAgo(3) });
    await recordLoginEvent({ userId: other.id, email: other.email, success: true, ip: "198.51.100.4" }, { now: daysAgo(3) });
    const result = await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "198.51.100.4" }, { now: NOW });
    expect(result.newNetwork).toBe(true);
  });

  it("never throws: a failed insert goes to onError and reports no alert", async () => {
    const user = await seedUser();
    await recordLoginEvent({ userId: user.id, email: user.email, success: true, ip: "203.0.113.9" }, { now: daysAgo(3) });
    vi.spyOn(prisma.loginEvent, "create").mockRejectedValueOnce(new Error("insert failed"));
    const errors: unknown[] = [];
    const result = await recordLoginEvent(
      { userId: user.id, email: user.email, success: true, ip: "198.51.100.4" },
      { now: NOW, onError: (error) => errors.push(error) },
    );
    expect(result).toEqual({ written: false, newNetwork: false, ipPrefix: "198.51.100.0/24" });
    expect(errors).toHaveLength(1);
  });

  it("purge keeps 180 days and deletes older rows", async () => {
    await prisma.loginEvent.createMany({
      data: [
        { email: "a@example.com", success: true, at: new Date(NOW.getTime() - (LOGIN_EVENT_RETENTION_DAYS + 1) * DAY) },
        { email: "b@example.com", success: false, at: new Date(NOW.getTime() - LOGIN_EVENT_RETENTION_DAYS * DAY) },
        { email: "c@example.com", success: true, at: new Date(NOW.getTime() - 10 * DAY) },
      ],
    });
    expect(await purgeLoginEvents(NOW)).toBe(1);
    const left = await prisma.loginEvent.findMany({ orderBy: { email: "asc" } });
    expect(left.map((row) => row.email)).toEqual(["b@example.com", "c@example.com"]);
  });

  it("counts only transcript views and recording streams by one actor inside 10 minutes", async () => {
    const row = (actorUserId: string, action: string, minutesAgo: number) => ({
      actorUserId,
      actorRole: "client_staff",
      clientId: "client_1",
      action,
      entityType: "call_record",
      entityId: "call_1",
      at: new Date(NOW.getTime() - minutesAgo * 60_000),
    });
    await prisma.accessLog.createMany({
      data: [
        row("staff_1", "call.transcript.view", 1),
        row("staff_1", "call.recording.stream", 9),
        row("staff_1", "call.transcript.view", 11),
        row("staff_1", "message.view", 1),
        row("staff_1", "call.raw.view", 1),
        row("staff_2", "call.transcript.view", 1),
      ],
    });
    expect(await countRecentBulkReads("staff_1", NOW)).toBe(2);
    expect(await countRecentBulkReads("staff_2", NOW)).toBe(1);
  });
});
