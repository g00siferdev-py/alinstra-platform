import { randomBytes } from "node:crypto";
import { prisma } from "@alinstra/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createInvite } from "./invites";
import { resetMemoryCounter } from "./counter";
import { LOGIN_LOCKOUT } from "./constants";
import { getCounter } from "./counter";
import { clearLoginFailures, loginLocked, recordLoginFailure } from "./lockout";

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "change_log", "knowledge_document", "knowledge_base", "wizard_draft", "session", "account", "twoFactor", "verification", "invite", "user", "client", "plan" CASCADE`,
  );
}

describe("acceptInvite", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("attaches the user to the invite clientId even if a different id is supplied", async () => {
    const clientA = await prisma.client.create({ data: { name: "A" } });
    const clientB = await prisma.client.create({ data: { name: "B" } });
    const admin = await prisma.user.create({
      data: {
        id: "admin_invite_test",
        name: "Admin",
        email: "admin-invite@example.com",
        role: "admin",
      },
    });

    const token = randomBytes(32).toString("base64url");
    const { createHash } = await import("node:crypto");
    const { encryptString } = await import("@alinstra/crypto");
    const { getEnv } = await import("@alinstra/config");
    await prisma.invite.create({
      data: {
        email: "owner@example.com",
        role: "client_owner",
        clientId: clientA.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        tokenCipher: encryptString(token, getEnv().ENCRYPTION_KEY),
        expiresAt: new Date(Date.now() + 60_000),
        createdById: admin.id,
      },
    });

    const forged: { token: string; name: string; password: string; clientId: string } = {
      token,
      name: "Owner",
      password: "correct-horse-battery",
      clientId: clientB.id,
    };
    const created = await acceptInvite(forged);
    const user = await prisma.user.findUnique({ where: { id: created.id } });
    expect(user?.clientId).toBe(clientA.id);
    expect(user?.clientId).not.toBe(clientB.id);
    expect(user?.role).toBe("client_owner");

    await expect(acceptInvite({ token, name: "Again", password: "correct-horse-battery" })).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it("lets an owner invite staff only for their own client", async () => {
    const clientA = await prisma.client.create({ data: { name: "A" } });
    const clientB = await prisma.client.create({ data: { name: "B" } });
    await expect(
      createInvite({
        actor: { id: "owner", role: "client_owner", clientId: clientA.id },
        email: "staff@example.com",
        role: "client_staff",
        clientId: clientB.id,
      }),
    ).rejects.toThrow(/own client/);
  });
});

describe("login lockout", () => {
  beforeEach(() => {
    resetMemoryCounter();
  });

  it("locks after 5 failures for the same account and IP", async () => {
    const email = "person@example.com";
    const ip = "203.0.113.10";
    for (let attempt = 0; attempt < LOGIN_LOCKOUT.maxFailures; attempt += 1) {
      expect(await loginLocked(email, ip)).toBe(false);
      await recordLoginFailure(email, ip);
    }
    expect(await loginLocked(email, ip)).toBe(true);
    expect(await loginLocked(email, "203.0.113.11")).toBe(false);
    expect(await loginLocked("other@example.com", ip)).toBe(false);
    await clearLoginFailures(email, ip);
    expect(await loginLocked(email, ip)).toBe(false);
    expect(getCounter()).toBeTruthy();
  });
});
