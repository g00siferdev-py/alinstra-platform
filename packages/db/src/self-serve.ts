import { recordChange, type Actor } from "./changes";
import { prisma } from "./client";
import { emptyWizardPayload } from "./domain";
import { TERMS_VERSION } from "./founding";

function json(value: unknown) {
  return value as never;
}

export type SelfServeClientInput = {
  businessName: string;
  ownerName: string;
  email: string;
  mobilePhone: string;
  planId: string;
};

/** True when a user with this email already exists (friendly signup message). */
export async function emailAlreadyRegistered(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  return Boolean(existing);
}

/**
 * Creates the unpaid self-serve Client shell (status lead, billingStatus none).
 * Call createCredentialUser next with this clientId, then `attachSelfServeSignup`.
 */
export async function createSelfServeClient(input: SelfServeClientInput) {
  const businessName = input.businessName.trim();
  const ownerName = input.ownerName.trim();
  const email = input.email.trim().toLowerCase();
  const mobilePhone = input.mobilePhone.trim();
  if (!businessName) throw new Error("Enter a business name.");
  if (!ownerName) throw new Error("Enter your name.");
  if (!email) throw new Error("Enter an email.");
  if (!mobilePhone) throw new Error("Enter a mobile phone.");

  const plan = await prisma.plan.findFirst({ where: { id: input.planId, active: true } });
  if (!plan) throw new Error("That plan is not available.");

  const client = await prisma.client.create({
    data: {
      name: businessName,
      status: "lead",
      planId: plan.id,
      billingStatus: "none",
      selfServe: true,
      contactName: ownerName,
      contactEmail: email,
      contactPhone: mobilePhone,
      portalOwnerEmail: email,
      timezone: "America/New_York",
    },
  });
  return { client, plan };
}

/**
 * After the owner User exists: WizardDraft, KnowledgeBase, and ChangeLog in one transaction.
 */
export async function attachSelfServeSignup(input: {
  clientId: string;
  ownerUserId: string;
  businessName: string;
  ownerName: string;
  email: string;
  mobilePhone: string;
  planId: string;
  planCode: string;
}) {
  const actor: Actor = { id: input.ownerUserId, role: "client_owner", clientId: input.clientId };
  const payload = {
    ...emptyWizardPayload(),
    business: {
      name: input.businessName.trim(),
      timezone: "America/New_York",
      contactName: input.ownerName.trim(),
      contactPhone: input.mobilePhone.trim(),
      contactEmail: input.email.trim().toLowerCase(),
    },
    plan: { planId: input.planId, setupFeeWaived: false },
    portalOwnerEmail: input.email.trim().toLowerCase(),
  };

  return prisma.$transaction(async (tx) => {
    await tx.wizardDraft.create({
      data: {
        clientId: input.clientId,
        currentStep: 1,
        payload: json(payload),
        createdById: input.ownerUserId,
      },
    });
    await tx.knowledgeBase.create({
      data: { clientId: input.clientId, version: 1, status: "draft" },
    });
    await recordChange(tx, {
      clientId: input.clientId,
      actor,
      action: "client.self_serve_signup",
      entityType: "client",
      entityId: input.clientId,
      summary: `Self-serve signup for ${input.businessName.trim()}`,
      after: {
        name: input.businessName.trim(),
        planId: input.planId,
        planCode: input.planCode,
        termsVersion: TERMS_VERSION,
      },
    });
  });
}

/** Best-effort cleanup if user creation fails after the client shell was created. */
export async function abandonSelfServeClient(clientId: string) {
  await prisma.client.update({
    where: { id: clientId },
    data: { archivedAt: new Date() },
  });
}
