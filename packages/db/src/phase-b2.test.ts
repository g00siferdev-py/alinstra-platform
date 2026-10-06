import { MemoryBilling, MemoryVoice } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminOverview } from "./admin-overview";
import { prisma } from "./client";
import { FOUNDING_OFFER } from "./founding";
import {
  applyFoundingWaiverAtCheckout,
  countPaidFoundingWaivers,
  ensureSelfServeCheckout,
  openCheckout,
  type Phase3Deps,
} from "./provision";
import { resetTestDatabase } from "./reset-test-database";
import { submitWizard } from "./wizard";

const admin = { id: "admin_phase_b2", role: "admin" as const };

async function seedPlan(code: string, setupFeeCents = 29900) {
  return prisma.plan.create({
    data: {
      code,
      name: code,
      monthlyPriceCents: 19900,
      includedMinutes: 300,
      overagePerMinuteCents: 35,
      setupFeeCents,
      extraChangeFeeCents: 4900,
      recallMonthlyCents: 0,
      recallPerBookingCents: 0,
      sortOrder: 1,
      active: true,
    },
  });
}

async function seedClient(options: {
  planId: string;
  selfServe?: boolean;
  setupFeeWaived?: boolean;
  paidAt?: Date | null;
  internal?: boolean;
  name?: string;
}) {
  return prisma.client.create({
    data: {
      name: options.name ?? "Self Serve Co",
      status: "lead",
      planId: options.planId,
      billingStatus: "none",
      selfServe: options.selfServe ?? true,
      setupFeeWaived: options.setupFeeWaived ?? false,
      paidAt: options.paidAt ?? null,
      internal: options.internal ?? false,
      contactEmail: "owner@example.com",
      stripeCustomerId: `cus_${options.name ?? "ss"}`,
    },
  });
}

function deps(billing: MemoryBilling): Phase3Deps {
  return {
    voice: new MemoryVoice(),
    billing,
    appUrl: "https://staging.alinstra.com",
    danielNumber: null,
    danielEmail: "daniel@alinstra.com",
    defaultAreaCode: "423",
    defaultTollFree: false,
  };
}

describe("Phase B Part 2 checkout and self-serve", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("openCheckout waives founding setup when under the cap and records setupFeeWaived", async () => {
    const plan = await seedPlan("starter");
    const client = await seedClient({ planId: plan.id, name: "founding1" });
    const billing = new MemoryBilling();

    expect(FOUNDING_OFFER.active).toBe(true);
    expect(await countPaidFoundingWaivers()).toBe(0);

    const waived = await applyFoundingWaiverAtCheckout(client.id, plan.code);
    expect(waived).toBe(true);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).setupFeeWaived).toBe(true);

    await openCheckout(client.id, deps(billing), {
      urls: { successUrl: "https://staging.alinstra.com/home?welcome=1", cancelUrl: "https://staging.alinstra.com/signup/canceled" },
    });

    expect(billing.lastCheckout?.setupPriceId).toBeNull();
    expect(billing.lastCheckout?.successUrl).toContain("/home?welcome=1");
    expect(billing.lastCheckout?.cancelUrl).toContain("/signup/canceled");
    expect(billing.lastCheckout?.recurringPriceId).toBeTruthy();
  });

  it("openCheckout keeps setup fee when founding slots are full", async () => {
    const plan = await seedPlan("professional");
    for (let i = 0; i < FOUNDING_OFFER.maxPaidWaivers; i += 1) {
      await seedClient({
        planId: plan.id,
        name: `paid${i}`,
        setupFeeWaived: true,
        paidAt: new Date(),
        selfServe: false,
      });
    }
    const client = await seedClient({ planId: plan.id, name: "latecomer", setupFeeWaived: false });
    const billing = new MemoryBilling();

    expect(await countPaidFoundingWaivers()).toBe(FOUNDING_OFFER.maxPaidWaivers);
    expect(await applyFoundingWaiverAtCheckout(client.id, plan.code)).toBe(false);

    await openCheckout(client.id, deps(billing));
    expect(billing.lastCheckout?.setupPriceId).toContain("setup");
  });

  it("openCheckout includes metered price when a StripePrice row exists", async () => {
    const plan = await seedPlan("solo", 9900);
    const client = await seedClient({ planId: plan.id, name: "metered", setupFeeWaived: true });
    await prisma.stripePrice.create({
      data: {
        lookupKey: `plan_${plan.code}_overage_${plan.includedMinutes}_${plan.overagePerMinuteCents}`,
        stripePriceId: "price_metered_test",
        planCode: plan.code,
        kind: "metered_overage",
        amountCents: plan.overagePerMinuteCents,
      },
    });
    const billing = new MemoryBilling();
    await openCheckout(client.id, deps(billing));
    expect(billing.lastCheckout?.meteredPriceId).toBe("price_metered_test");
  });

  it("ensureSelfServeCheckout creates the customer then opens checkout", async () => {
    const plan = await seedPlan("starter");
    const client = await prisma.client.create({
      data: {
        name: "No Customer Yet",
        status: "lead",
        planId: plan.id,
        billingStatus: "none",
        selfServe: true,
        contactEmail: "new@example.com",
      },
    });
    const billing = new MemoryBilling();
    const session = await ensureSelfServeCheckout(client.id, deps(billing));
    expect(session.url).toContain("checkout.stripe.test");
    expect(billing.creates.customer).toBe(1);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).stripeCustomerId).toBeTruthy();
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).billingStatus).toBe("checkout_open");
    expect(billing.lastCheckout?.customerUpdateAddress).toBe("auto");
    expect(billing.lastCheckout?.customerUpdateName).toBe("auto");
    expect(billing.lastCheckout?.taxIdCollection).toBe(false);
  });

  it("admin overview lists self-serve signups awaiting review", async () => {
    await prisma.user.create({
      data: { id: admin.id, name: "Admin", email: "admin-b2@example.com", emailVerified: true, role: "admin" },
    });
    const plan = await seedPlan("starter");
    await seedClient({
      planId: plan.id,
      name: "Awaiting Review LLC",
      selfServe: true,
    });
    await prisma.client.updateMany({
      where: { name: "Awaiting Review LLC" },
      data: { wizardSubmittedAt: new Date(), status: "lead" },
    });

    const overview = await adminOverview(admin);
    const todo = overview.todos.find((item) => item.kind === "self_serve_review");
    expect(todo?.title).toBe("New self-serve signup awaiting review");
    expect(todo?.detail).toContain("Awaiting Review LLC");
  });

  it("submitWizard blocks an unverified owner and allows a verified owner", async () => {
    const plan = await seedPlan("solo", 9900);
    const client = await prisma.client.create({
      data: {
        name: "Owner Submit Co",
        status: "lead",
        planId: plan.id,
        selfServe: true,
        contactEmail: "verify@example.com",
        portalOwnerEmail: "verify@example.com",
      },
    });
    const owner = await prisma.user.create({
      data: {
        id: "owner_unverified",
        name: "Owner",
        email: "verify@example.com",
        emailVerified: false,
        role: "client_owner",
        clientId: client.id,
      },
    });
    const payload = {
      version: 1 as const,
      business: {
        name: "Owner Submit Co",
        industry: "hvac",
        contactName: "Owner",
        contactEmail: "verify@example.com",
        timezone: "America/New_York",
      },
      plan: { planId: plan.id, setupFeeWaived: false },
      portalOwnerEmail: "verify@example.com",
      compliance: { aiDisclosure: true, recordingNotice: true },
      knowledge: {
        hours: "Mon-Fri 9:00-17:00",
        services: "Repairs",
        faqs: "Where are you?",
        policies: "No walk-ins",
        staff: "Owner",
      },
    };
    const draft = await prisma.wizardDraft.create({
      data: { clientId: client.id, currentStep: 11, payload, createdById: owner.id },
    });
    await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "draft" } });

    const actor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    await expect(
      submitWizard(actor, { clientId: client.id, payload, updatedAt: draft.updatedAt.toISOString() }),
    ).rejects.toThrow(/Confirm your email to submit/);

    await prisma.user.update({ where: { id: owner.id }, data: { emailVerified: true } });
    const refreshed = await prisma.wizardDraft.findUniqueOrThrow({ where: { id: draft.id } });
    await submitWizard(actor, { clientId: client.id, payload, updatedAt: refreshed.updatedAt.toISOString() });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).wizardSubmittedAt).toBeTruthy();
  });
});
