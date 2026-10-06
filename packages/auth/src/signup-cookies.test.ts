import { prisma, resetTestDatabase, seedPlans } from "@alinstra/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { __clearCookieSets, __cookieSets } from "../test-stubs/next-headers";
import { createCredentialUser } from "./users";

describe("signup session cookies", () => {
  beforeEach(async () => {
    __clearCookieSets();
    await resetTestDatabase();
    await seedPlans();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps nextCookies last so server-action sign-in can write the session cookie", async () => {
    const { auth } = await import("./auth");
    const context = await auth.$context;
    const plugins = context.options.plugins ?? [];
    expect(plugins.at(-1)?.id).toBe("next-cookies");
  });

  it("sets a session cookie when signInEmail runs (signup action path)", async () => {
    const { auth } = await import("./auth");
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "starter" } });
    const client = await prisma.client.create({
      data: {
        name: "Cookie Co",
        status: "lead",
        planId: plan.id,
        billingStatus: "none",
        selfServe: true,
      },
    });
    const email = "cookie-owner@example.com";
    const password = "correct-horse-battery";
    await createCredentialUser({
      email,
      name: "Cookie Owner",
      password,
      role: "client_owner",
      clientId: client.id,
      emailVerified: false,
    });

    await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({ "x-real-ip": "127.0.0.1", origin: "http://localhost:3000" }),
    });

    const names = __cookieSets().map((row) => row.name);
    expect(names.some((name) => /session/i.test(name))).toBe(true);
    expect(__cookieSets().some((row) => row.value.length > 0)).toBe(true);
  });
});
