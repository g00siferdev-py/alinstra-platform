import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetTestDatabase } from "./reset-test-database";
import { clients, createClient, users } from "./repositories";
import type { TenantContext } from "./tenant";

async function resetDatabase(): Promise<void> {
  await resetTestDatabase();
}

async function seedPair() {
  const clientA = await prisma.client.create({ data: { name: "Client A" } });
  const clientB = await prisma.client.create({ data: { name: "Client B" } });
  const staffA = await prisma.user.create({
    data: {
      id: "user_staff_a",
      name: "Staff A",
      email: "staff-a@example.com",
      role: "client_staff",
      clientId: clientA.id,
    },
  });
  const ownerA = await prisma.user.create({
    data: {
      id: "user_owner_a",
      name: "Owner A",
      email: "owner-a@example.com",
      role: "client_owner",
      clientId: clientA.id,
    },
  });
  const staffB = await prisma.user.create({
    data: {
      id: "user_staff_b",
      name: "Staff B",
      email: "staff-b@example.com",
      role: "client_staff",
      clientId: clientB.id,
    },
  });
  return { clientA, clientB, staffA, ownerA, staffB };
}

describe("clientId isolation", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("hides another client's users and client row from client_staff", async () => {
    const { clientA, clientB, staffB } = await seedPair();
    const ctx: TenantContext = { role: "client_staff", clientId: clientA.id };
    const visible = await users(ctx).list();
    expect(visible.map((user) => user.id)).not.toContain(staffB.id);
    expect(visible.every((user) => user.clientId === clientA.id)).toBe(true);
    expect(await users(ctx).getById(staffB.id)).toBeNull();
    expect(await clients(ctx).getById(clientB.id)).toBeNull();
    const listed = await clients(ctx).list();
    expect(listed.map((client) => client.id)).toEqual([clientA.id]);
  });

  it("scopes client_owner to their clientId", async () => {
    const { clientA, staffB } = await seedPair();
    const ctx: TenantContext = { role: "client_owner", clientId: clientA.id };
    const visible = await users(ctx).list();
    expect(visible.every((user) => user.clientId === clientA.id)).toBe(true);
    expect(await users(ctx).getById(staffB.id)).toBeNull();
  });

  it("lets admin read every client and filter to one", async () => {
    const { clientA, clientB, staffB } = await seedPair();
    const all = await users({ role: "admin" }).list();
    expect(all.map((user) => user.id)).toContain(staffB.id);
    const filtered = await users({ role: "admin", clientId: clientB.id }).list();
    expect(filtered.map((user) => user.id)).toEqual([staffB.id]);
    expect(await clients({ role: "admin" }).getById(clientA.id)).not.toBeNull();
  });

  it("refuses client creation from a client role", async () => {
    const { clientA } = await seedPair();
    await expect(createClient({ role: "client_owner", clientId: clientA.id }, "Nope")).rejects.toThrow(
      /admin/,
    );
  });
});

describe("repository contract", () => {
  it("requires TenantContext on every exported data-access function", () => {
    const source = readFileSync(resolve(import.meta.dirname, "repositories.ts"), "utf8");
    const exports = [...source.matchAll(/^export (?:async )?function (\w+)\(([^)]*)\)/gm)];
    expect(exports.length).toBeGreaterThan(0);
    for (const match of exports) {
      expect(match[2], match[1]).toMatch(/ctx: TenantContext/);
    }
    const factories = [...source.matchAll(/^export function (\w+)\(ctx: TenantContext\)/gm)];
    expect(factories.map((match) => match[1]).sort()).toEqual(["clients", "users"]);
    for (const file of ["plans.ts", "knowledge.ts", "wizard.ts", "agent.ts"]) {
      const extra = readFileSync(resolve(import.meta.dirname, file), "utf8");
      const exported = [...extra.matchAll(/^export (?:async )?function (\w+)\(([^)]*)\)/gm)];
      expect(exported.length, file).toBeGreaterThan(0);
      for (const match of exported) {
        // Tenant-free helpers: plan seeds/catalog for marketing, and pure formatters.
        if (
          match[1] === "seedPlans" ||
          match[1] === "publicPlans" ||
          match[1] === "formatPlanCents" ||
          match[1] === "formatOveragePerMinute" ||
          match[1] === "formatIncludedChanges"
        ) {
          continue;
        }
        expect(match[2], `${file} ${match[1]}`).toMatch(/ctx: (?:TenantContext|Actor)/);
      }
    }
  });
});
