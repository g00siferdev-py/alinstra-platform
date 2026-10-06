import { prisma, resetTestDatabase } from "@alinstra/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const queued = vi.hoisted(() => [] as string[]);

vi.mock("@alinstra/queue", async (importOriginal) => {
  const original = await importOriginal<typeof import("@alinstra/queue")>();
  return { ...original, enqueueSendInvite: async (data: { inviteId: string }) => void queued.push(data.inviteId) };
});

import { AuthError } from "./users";
import { resetMemoryCounter } from "./counter";
import { createInvite, RateLimitError } from "./invites";

async function setup() {
  const clientA = await prisma.client.create({ data: { name: "A" } });
  const clientB = await prisma.client.create({ data: { name: "B" } });
  return { clientA, clientB };
}

describe("invite rate limit", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetMemoryCounter();
    queued.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows 10 invites an hour per client, then refuses with a retry time", async () => {
    const { clientA } = await setup();
    const actor = { id: "owner_a", role: "client_owner", clientId: clientA.id } as const;
    for (let index = 0; index < 10; index += 1) {
      await createInvite({ actor, email: `staff${index}@example.com`, role: "client_staff", clientId: clientA.id });
    }
    expect(queued).toHaveLength(10);

    const error = await createInvite({ actor, email: "one-too-many@example.com", role: "client_staff", clientId: clientA.id }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(AuthError);
    const limited = error as RateLimitError;
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(limited.message).toMatch(/too many invites/i);
    // Nothing was created or queued for the refused invite.
    expect(queued).toHaveLength(10);
    expect(await prisma.invite.count({ where: { clientId: clientA.id } })).toBe(10);
  });

  it("counts resends and admin invites in the same per-client bucket, and leaves other clients alone", async () => {
    const { clientA, clientB } = await setup();
    const admin = { id: "admin_1", role: "admin" } as const;
    // The admin "resend" is another invite to the same address.
    for (let index = 0; index < 10; index += 1) {
      await createInvite({ actor: admin, email: "owner@example.com", role: "client_owner", clientId: clientA.id });
    }
    await expect(createInvite({ actor: admin, email: "owner@example.com", role: "client_owner", clientId: clientA.id })).rejects.toBeInstanceOf(RateLimitError);
    await expect(
      createInvite({ actor: { id: "owner_a", role: "client_owner", clientId: clientA.id }, email: "s@example.com", role: "client_staff", clientId: clientA.id }),
    ).rejects.toBeInstanceOf(RateLimitError);
    await expect(createInvite({ actor: admin, email: "owner-b@example.com", role: "client_owner", clientId: clientB.id })).resolves.toHaveProperty("id");
  });

  it("does not spend a client's allowance on refused callers", async () => {
    const { clientA, clientB } = await setup();
    for (let index = 0; index < 15; index += 1) {
      await expect(
        createInvite({ actor: { id: "staff_a", role: "client_staff", clientId: clientA.id }, email: "x@example.com", role: "client_staff", clientId: clientA.id }),
      ).rejects.toThrow(/cannot send invites/);
      await expect(
        createInvite({ actor: { id: "owner_b", role: "client_owner", clientId: clientB.id }, email: "x@example.com", role: "client_staff", clientId: clientA.id }),
      ).rejects.toThrow(/own client/);
    }
    await expect(
      createInvite({ actor: { id: "owner_a", role: "client_owner", clientId: clientA.id }, email: "ok@example.com", role: "client_staff", clientId: clientA.id }),
    ).resolves.toHaveProperty("id");
  });
});
