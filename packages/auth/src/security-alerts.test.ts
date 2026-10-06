import { prisma, resetTestDatabase } from "@alinstra/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  admin: [] as Array<{ subject: string; text: string }>,
  owner: [] as Array<Record<string, unknown>>,
  failQueue: false,
}));

vi.mock("@alinstra/queue", async (importOriginal) => {
  const original = await importOriginal<typeof import("@alinstra/queue")>();
  return {
    ...original,
    enqueueSendAdminNotice: async (notice: { subject: string; text: string }) => {
      if (sent.failQueue) throw new Error("redis down");
      sent.admin.push(notice);
    },
    enqueueSignInNotice: async (notice: Record<string, unknown>) => {
      if (sent.failQueue) throw new Error("redis down");
      sent.owner.push(notice);
    },
  };
});

import { LOGIN_LOCKOUT } from "./constants";
import { resetMemoryCounter } from "./counter";
import { handleAuthRequest } from "./handler";
import { trackSignIn, type AlertDeps, type SignInAttempt } from "./security-alerts";
import { createCredentialUser } from "./users";

const origin = "http://localhost:3000";
const password = "correct-horse-battery";

function attempt(overrides: Partial<SignInAttempt> = {}): SignInAttempt {
  return { user: { id: "u1", role: "client_owner", clientId: "c1" }, email: "Owner@Example.com", success: true, ip: "203.0.113.9", userAgent: "UA", ...overrides };
}

function deps(overrides: Partial<AlertDeps> = {}): AlertDeps & { admin: Array<{ subject: string; text: string }>; owner: Array<Record<string, unknown>> } {
  const admin: Array<{ subject: string; text: string }> = [];
  const owner: Array<Record<string, unknown>> = [];
  const counts = new Map<string, number>();
  return {
    admin,
    owner,
    record: async (input) => ({ written: true, newNetwork: input.email === "newnet@example.com", ipPrefix: "203.0.113.0/24" }),
    adminNotice: async (notice) => {
      admin.push(notice);
    },
    ownerNotice: async (notice) => {
      owner.push(notice);
    },
    locked: async () => true,
    counter: () => ({
      increment: async (key) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      get: async (key) => counts.get(key) ?? 0,
      clear: async (key) => {
        counts.delete(key);
      },
    }),
    clientTimezone: async () => "America/Chicago",
    now: () => new Date("2026-10-06T16:30:00Z"),
    ...overrides,
  };
}

describe("trackSignIn (unit)", () => {
  it("emails an owner from a new network with time, browser, and a masked prefix only", async () => {
    const d = deps();
    await trackSignIn(attempt({ email: "newnet@example.com", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" }), d);
    expect(d.admin).toEqual([]);
    expect(d.owner).toHaveLength(1);
    expect(d.owner[0]).toEqual({
      to: "newnet@example.com",
      at: "2026-10-06T16:30:00.000Z",
      browser: "Chrome on Windows",
      maskedNetwork: "203.0.x.x",
      timezone: "America/Chicago",
    });
    expect(JSON.stringify(d.owner)).not.toContain("203.0.113");
  });

  it("sends admins the existing admin notice for a new network", async () => {
    const d = deps();
    await trackSignIn(attempt({ email: "newnet@example.com", user: { id: "a1", role: "admin", clientId: null } }), d);
    expect(d.owner).toEqual([]);
    expect(d.admin).toHaveLength(1);
    expect(d.admin[0]!.subject).toBe("Admin sign-in from a new network");
    expect(d.admin[0]!.text).toContain("203.0.x.x");
    expect(d.admin[0]!.text).not.toContain("203.0.113");
  });

  it("sends nothing for staff, an unknown user, a known network, or a failed attempt", async () => {
    const d = deps();
    await trackSignIn(attempt({ email: "newnet@example.com", user: { id: "s1", role: "client_staff", clientId: "c1" } }), d);
    await trackSignIn(attempt({ email: "newnet@example.com", user: null }), d);
    await trackSignIn(attempt({ email: "known@example.com" }), d);
    await trackSignIn(attempt({ email: "newnet@example.com", success: false }), d);
    expect(d.admin).toEqual([]);
    expect(d.owner).toEqual([]);
  });

  it("tells admins when an admin account hits the lockout, once per hour", async () => {
    const d = deps();
    const admin = { id: "a1", role: "admin", clientId: null };
    await trackSignIn(attempt({ user: admin, success: false, checkLockout: true }), d);
    await trackSignIn(attempt({ user: admin, success: false, checkLockout: true }), d);
    expect(d.admin).toHaveLength(1);
    expect(d.admin[0]!.subject).toBe("Admin account locked after failed sign-ins");
  });

  it("does not alert on lockout for owners, when not locked, or when the caller did not ask", async () => {
    const d = deps();
    await trackSignIn(attempt({ success: false, checkLockout: true }), d);
    await trackSignIn(attempt({ user: { id: "a1", role: "admin", clientId: null }, success: false, checkLockout: true }), deps({ locked: async () => false }));
    await trackSignIn(attempt({ user: { id: "a1", role: "admin", clientId: null }, success: false }), d);
    expect(d.admin).toEqual([]);
  });

  it("never throws when logging or the queue fail", async () => {
    const boom = async () => {
      throw new Error("down");
    };
    const d = deps({ record: boom, adminNotice: boom, ownerNotice: boom });
    await expect(trackSignIn(attempt({ email: "newnet@example.com" }), d)).resolves.toBeUndefined();
    const e = deps({ ownerNotice: boom, adminNotice: boom });
    await expect(trackSignIn(attempt({ email: "newnet@example.com" }), e)).resolves.toBeUndefined();
    await expect(trackSignIn(attempt({ user: { id: "a1", role: "admin", clientId: null }, success: false, checkLockout: true }), e)).resolves.toBeUndefined();
  });
});

async function signIn(email: string, pass: string, ip: string, userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15"): Promise<Response> {
  return handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-real-ip": ip, "user-agent": userAgent },
      body: JSON.stringify({ email, password: pass }),
    }),
  );
}

describe("sign-in tracking through the auth handler", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetMemoryCounter();
    sent.admin.length = 0;
    sent.owner.length = 0;
    sent.failQueue = false;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed() {
    const client = await prisma.client.create({ data: { name: "Alpha", timezone: "America/Chicago" } });
    await createCredentialUser({ email: "owner@example.com", name: "Olivia", password, role: "client_owner", clientId: client.id });
    await createCredentialUser({ email: "boss@example.com", name: "Boss", password, role: "admin", clientId: null });
    return client;
  }

  it("writes a LoginEvent for success, wrong password, unknown email, and a locked attempt", async () => {
    await seed();
    expect((await signIn("Owner@Example.com", password, "203.0.113.9")).status).toBe(200);
    expect((await signIn("owner@example.com", "wrong-password-123", "203.0.113.9")).status).toBe(401);
    expect((await signIn("ghost@example.com", "wrong-password-123", "198.51.100.1")).status).toBe(401);

    for (let index = 0; index < LOGIN_LOCKOUT.maxFailures; index += 1) await signIn("owner@example.com", "wrong-password-123", "203.0.113.9");
    expect((await signIn("owner@example.com", password, "203.0.113.9")).status).toBe(429);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    const events = await prisma.loginEvent.findMany({ orderBy: { at: "asc" } });
    const first = events[0]!;
    expect(first).toMatchObject({ userId: owner.id, email: "owner@example.com", success: true, ip: "203.0.113.9", ipPrefix: "203.0.113.0/24" });
    expect(first.userAgent).toContain("Safari");
    expect(events[1]).toMatchObject({ userId: owner.id, success: false });
    expect(events[2]).toMatchObject({ userId: null, email: "ghost@example.com", success: false, ipPrefix: "198.51.100.0/24" });
    // The locked attempt is logged too, even though the right password was supplied.
    const last = events[events.length - 1]!;
    expect(last).toMatchObject({ userId: owner.id, success: false });
    expect(events).toHaveLength(3 + LOGIN_LOCKOUT.maxFailures + 1);
    expect(JSON.stringify(events)).not.toContain(password);
    expect(JSON.stringify(events)).not.toContain("wrong-password-123");
  });

  it("alerts an owner on a sign-in from a new network, but not on the first login or a repeat network", async () => {
    await seed();
    await signIn("owner@example.com", password, "203.0.113.9");
    expect(sent.owner).toEqual([]);
    await signIn("owner@example.com", password, "203.0.113.50");
    expect(sent.owner).toEqual([]);

    expect((await signIn("owner@example.com", password, "198.51.100.77")).status).toBe(200);
    expect(sent.owner).toHaveLength(1);
    expect(sent.owner[0]).toMatchObject({ to: "owner@example.com", maskedNetwork: "198.51.x.x", browser: "Safari on macOS", timezone: "America/Chicago" });
    expect(JSON.stringify(sent.owner)).not.toContain("198.51.100");
    expect(sent.admin).toEqual([]);

    await signIn("owner@example.com", password, "198.51.100.5");
    expect(sent.owner).toHaveLength(1);
  });

  it("alerts admins through the admin notice on a new network", async () => {
    await seed();
    await signIn("boss@example.com", password, "203.0.113.9");
    await signIn("boss@example.com", password, "192.0.2.44");
    expect(sent.owner).toEqual([]);
    expect(sent.admin.map((notice) => notice.subject)).toEqual(["Admin sign-in from a new network"]);
    expect(sent.admin[0]!.text).toContain("192.0.x.x");
    expect(sent.admin[0]!.text).not.toContain("192.0.2");
  });

  it("sends one admin notice when an admin account hits the lockout, and none for an owner", async () => {
    await seed();
    for (let index = 0; index < LOGIN_LOCKOUT.maxFailures; index += 1) {
      await signIn("boss@example.com", "wrong-password-123", "203.0.113.9");
    }
    await signIn("boss@example.com", password, "203.0.113.9");
    expect(sent.admin.map((notice) => notice.subject)).toEqual(["Admin account locked after failed sign-ins"]);

    sent.admin.length = 0;
    for (let index = 0; index < LOGIN_LOCKOUT.maxFailures; index += 1) {
      await signIn("owner@example.com", "wrong-password-123", "203.0.113.9");
    }
    expect(sent.admin).toEqual([]);
  });

  it("never breaks a login when the queue is down", async () => {
    await seed();
    await signIn("owner@example.com", password, "203.0.113.9");
    sent.failQueue = true;
    const response = await signIn("owner@example.com", password, "198.51.100.77");
    expect(response.status).toBe(200);
    expect(await prisma.loginEvent.count({ where: { success: true } })).toBe(2);
  });

  it("never breaks a login when the LoginEvent insert fails", async () => {
    await seed();
    const spy = vi.spyOn(prisma.loginEvent, "create").mockRejectedValue(new Error("db down"));
    try {
      expect((await signIn("owner@example.com", password, "203.0.113.9")).status).toBe(200);
      expect((await signIn("owner@example.com", "wrong-password-123", "203.0.113.9")).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});
