import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { publicSiteConfig, resetPublicSiteConfigCache } from "./public-site";
import { resetTestDatabase } from "./reset-test-database";

describe("publicSiteConfig", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetPublicSiteConfigCache();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns the internal client's public phone and email", async () => {
    await prisma.client.create({
      data: {
        name: "Alinstra",
        internal: true,
        status: "live",
        publicPhone: "+18883871525",
        publicEmail: "hello@alinstra.com",
      },
    });
    await expect(publicSiteConfig()).resolves.toEqual({
      phone: "+18883871525",
      email: "hello@alinstra.com",
    });
  });

  it("falls back when client zero is missing", async () => {
    const site = await publicSiteConfig();
    expect(site.email).toBe("hello@alinstra.com");
    expect(site.phone === null || typeof site.phone === "string").toBe(true);
  });
});
