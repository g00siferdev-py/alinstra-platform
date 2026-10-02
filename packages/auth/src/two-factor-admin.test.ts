import { createRequire } from "node:module";
import { prisma, resetTestDatabase } from "@alinstra/db";
import { symmetricDecrypt } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { handleAuthRequest } from "./handler";
import { createCredentialUser } from "./users";

const requireFromBetterAuth = createRequire(import.meta.resolve("better-auth"));
const { createOTP } = requireFromBetterAuth("@better-auth/utils/otp") as {
  createOTP: (secret: string) => { totp: () => Promise<string> };
};

const origin = "http://localhost:3000";
const password = "correct-horse-battery";

function cookieHeader(response: Response): string {
  const jar = new Map<string, string>();
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0] ?? "";
    const splitAt = pair.indexOf("=");
    if (splitAt <= 0) continue;
    jar.set(pair.slice(0, splitAt), pair.slice(splitAt + 1));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signIn(email: string): Promise<string> {
  const response = await handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieHeader(response);
}

async function rawSecret(email: string): Promise<string> {
  const row = await prisma.twoFactor.findFirstOrThrow({ where: { user: { email } } });
  const context = await auth.$context;
  const key = (context as { secretConfig: Parameters<typeof symmetricDecrypt>[0]["key"] }).secretConfig;
  return symmetricDecrypt({ key, data: row.secret });
}

async function enroll(cookie: string, email: string): Promise<{ secret: string; backupCodes: string[]; cookie: string }> {
  const enabled = await handleAuthRequest(
    new Request(`${origin}/api/auth/two-factor/enable`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ password, method: "totp" }),
    }),
  );
  expect(enabled.status).toBe(200);
  const body = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  const secret = await rawSecret(email);
  const code = await createOTP(secret).totp();
  const verified = await handleAuthRequest(
    new Request(`${origin}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ code }),
    }),
  );
  expect(verified.status).toBe(200);
  const nextCookie = cookieHeader(verified);
  return { secret: secret ?? "", backupCodes: body.backupCodes, cookie: nextCookie || cookie };
}

describe("admin two-factor", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses to disable two-factor for an admin and allows a client user to disable it", async () => {
    const client = await prisma.client.create({ data: { name: "Client" } });
    await createCredentialUser({
      email: "admin-2fa@example.com",
      name: "Admin",
      password,
      role: "admin",
      clientId: null,
    });
    await createCredentialUser({
      email: "owner-2fa@example.com",
      name: "Owner",
      password,
      role: "client_owner",
      clientId: client.id,
    });

    const adminCookie = await enroll(await signIn("admin-2fa@example.com"), "admin-2fa@example.com");
    const blocked = await handleAuthRequest(
      new Request(`${origin}/api/auth/two-factor/disable`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: adminCookie.cookie },
        body: JSON.stringify({ password }),
      }),
    );
    expect(blocked.status).toBe(403);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin-2fa@example.com" } });
    expect(admin.twoFactorEnabled).toBe(true);
    expect(await prisma.twoFactor.count({ where: { userId: admin.id } })).toBe(1);

    const ownerCookie = await enroll(await signIn("owner-2fa@example.com"), "owner-2fa@example.com");
    const disabled = await handleAuthRequest(
      new Request(`${origin}/api/auth/two-factor/disable`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: ownerCookie.cookie },
        body: JSON.stringify({ password }),
      }),
    );
    expect(disabled.status).toBe(200);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner-2fa@example.com" } });
    expect(owner.twoFactorEnabled).toBe(false);
    expect(await prisma.twoFactor.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("replaces an admin authenticator only after a current code and keeps two-factor on", async () => {
    await createCredentialUser({
      email: "admin-2fa@example.com",
      name: "Admin",
      password,
      role: "admin",
      clientId: null,
    });
    const enrolled = await enroll(await signIn("admin-2fa@example.com"), "admin-2fa@example.com");
    const before = await prisma.twoFactor.findFirstOrThrow({
      where: { user: { email: "admin-2fa@example.com" } },
    });

    const rejected = await handleAuthRequest(
      new Request(`${origin}/api/auth/two-factor/re-enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: enrolled.cookie },
        body: JSON.stringify({ code: "000000" }),
      }),
    );
    expect(rejected.status).toBe(401);
    const unchanged = await prisma.twoFactor.findUniqueOrThrow({ where: { id: before.id } });
    expect(unchanged.secret).toBe(before.secret);

    const code = await createOTP(enrolled.secret).totp();
    const replaced = await handleAuthRequest(
      new Request(`${origin}/api/auth/two-factor/re-enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: enrolled.cookie },
        body: JSON.stringify({ code }),
      }),
    );
    expect(replaced.status).toBe(200);
    const body = (await replaced.json()) as { totpURI: string; backupCodes: string[] };
    const nextSecret = await rawSecret("admin-2fa@example.com");
    expect(nextSecret).not.toBe(enrolled.secret);
    expect(body.totpURI).toContain("otpauth://");
    expect(body.backupCodes.length).toBeGreaterThan(0);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin-2fa@example.com" } });
    expect(admin.twoFactorEnabled).toBe(true);
    const after = await prisma.twoFactor.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.verified).toBe(true);
    expect(after.secret).not.toBe(before.secret);

    const fromBackup = await handleAuthRequest(
      new Request(`${origin}/api/auth/two-factor/re-enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: enrolled.cookie },
        body: JSON.stringify({ code: body.backupCodes[0] }),
      }),
    );
    expect(fromBackup.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).twoFactorEnabled).toBe(true);
  });
});
