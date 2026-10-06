/**
 * Phase B Part 4 Stripe webhook handlers (extends Phase 3 applyStripeEvent).
 */
import { getEnv } from "@alinstra/config";
import { billingResumedOwnerEmail, paymentFailedOwnerEmail } from "@alinstra/email";
import { buildGreeting, type PromptFeatures } from "@alinstra/agent";
import { Prisma } from "./generated/prisma/client";
import { applyScheduledPlanChanges } from "./billing-lifecycle";
import { recordChange, type Actor } from "./changes";
import { prisma } from "./client";
import { officeOpen, formatTransferTargets, type WeeklyHours } from "./domain";

const WEBHOOK_ACTOR: Actor = { id: "provider-webhook", role: "admin" };
const PAUSED_CALL_MAX_MS = 15_000;

export type InboundDynamicVariables = { office_open: "yes" | "no"; allowed_targets: string };

export type InboundCallPayload = {
  dynamic_variables: InboundDynamicVariables;
  /** Per-call begin_message so open and closed openings stay one continuous utterance. */
  agent_override?: {
    agent?: { max_call_duration_ms?: number };
    retell_llm: {
      begin_message: string;
      general_prompt?: string;
      general_tools?: Array<{ type: string; name: string; description: string }>;
    };
  };
};

function inboundPersona(voice: unknown): { assistantName: string; disclosureMode: "on_request" | "upfront" } {
  const row = voice && typeof voice === "object" && !Array.isArray(voice) ? (voice as Record<string, unknown>) : {};
  return {
    assistantName: typeof row.assistantName === "string" && row.assistantName.trim() ? row.assistantName.trim() : "Ava",
    disclosureMode: row.disclosureMode === "upfront" ? "upfront" : "on_request",
  };
}

function inboundRecordingOn(compliance: unknown): boolean {
  const row = compliance && typeof compliance === "object" && !Array.isArray(compliance) ? (compliance as Record<string, unknown>) : {};
  return row.recordingNotice !== false;
}

function inboundFeatures(features: unknown): PromptFeatures {
  const row = features && typeof features === "object" && !Array.isArray(features) ? (features as Record<string, unknown>) : {};
  const mode = row.bookingMode;
  return {
    bookingMode: mode === "request_only" || mode === "direct_calendar" ? mode : null,
    liveTransfer: row.liveTransfer === true,
    messages: typeof row.messages === "string" ? row.messages : typeof row.messageRecipients === "string" ? row.messageRecipients : null,
  };
}

/** Dynamic variables plus a begin_message override for the continuous open/closed greeting. */
export async function inboundCallPayload(toNumber: string, now = new Date()): Promise<InboundCallPayload> {
  const client = await prisma.client.findFirst({ where: { phoneE164: toNumber, archivedAt: null } });
  if (!client) return { dynamic_variables: { office_open: "no", allowed_targets: "" } };

  if (client.billingStatus === "paused") {
    return {
      dynamic_variables: { office_open: "no", allowed_targets: "" },
      agent_override: {
        agent: { max_call_duration_ms: PAUSED_CALL_MAX_MS },
        retell_llm: {
          begin_message: `Thanks for calling ${client.name}. We can't take your call right now. Please try again later.`,
          general_prompt:
            "You already told the caller the office cannot take their call. Call the end_call tool immediately. Do not take a message. Do not ask any questions. Do not transfer.",
          general_tools: [
            {
              type: "end_call",
              name: "end_call",
              description: "End the call immediately after the opening message.",
            },
          ],
        },
      },
    };
  }

  const targets = await prisma.transferTarget.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } });
  const open = officeOpen(client.weeklyHours, client.timezone, now);
  const persona = inboundPersona(client.voice);
  const features = inboundFeatures(client.features);
  const beginMessage = buildGreeting({
    businessName: client.name,
    assistantName: persona.assistantName,
    disclosureMode: persona.disclosureMode,
    recordingNotice: inboundRecordingOn(client.compliance),
    hoursState: open ? "open" : "closed",
    features,
  });
  return {
    dynamic_variables: {
      office_open: open ? "yes" : "no",
      allowed_targets: targets.map((target) => target.label.trim()).join("; "),
    },
    agent_override: { retell_llm: { begin_message: beginMessage } },
  };
}

export async function inboundVariables(toNumber: string, now = new Date()): Promise<InboundDynamicVariables> {
  return (await inboundCallPayload(toNumber, now)).dynamic_variables;
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

export type StripeOwnerEmail = { to: string; subject: string; text: string };

export type StripeApplyResult = {
  notify?: { subject: string; text: string };
  ownerEmails?: StripeOwnerEmail[];
};

function stripeCustomerId(object: Record<string, unknown>): string {
  if (typeof object.customer === "string") return object.customer;
  if (object.customer && typeof object.customer === "object" && typeof (object.customer as { id?: unknown }).id === "string") {
    return (object.customer as { id: string }).id;
  }
  return "";
}

function unixDate(value: unknown, fallback: Date): Date {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1000);
}

function periodBoundsFromSubscription(object: Record<string, unknown>): { start: Date; end: Date } | null {
  const items = object.items as { data?: Array<{ current_period_start?: unknown; current_period_end?: unknown }> } | undefined;
  const rows = (items?.data ?? [])
    .map((item) => ({ start: Number(item.current_period_start), end: Number(item.current_period_end) }))
    .filter((row) => Number.isFinite(row.end) && row.end > 0);
  if (rows.length === 0) return null;
  const chosen = rows.reduce((best, row) => (row.end >= best.end ? row : best));
  const end = new Date(chosen.end * 1000);
  const start =
    Number.isFinite(chosen.start) && chosen.start > 0
      ? new Date(chosen.start * 1000)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end };
}

async function resolveOwnerEmail(clientId: string, portalOwnerEmail: string | null): Promise<string | null> {
  if (portalOwnerEmail?.trim()) return portalOwnerEmail.trim().toLowerCase();
  const owner = await prisma.user.findFirst({
    where: { clientId, role: "client_owner" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return owner?.email?.trim().toLowerCase() || null;
}

function appBillingUrl(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/home/billing`;
}

type PendingOwnerMail = { clientId: string; portalOwnerEmail: string | null; kind: "payment_failed" | "resumed" };
type PendingPeriod = { clientId: string; prevStart: Date | null; nextStart: Date | null };

export async function applyStripeEvent(event: StripeEvent, now = new Date()): Promise<StripeApplyResult> {
  const eventId = event.id ?? "";
  if (!eventId || !event.type) return {};
  const object = event.data?.object ?? {};
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as { client_id?: string }) : {};
  const clientId = metadata.client_id ?? (typeof object.client_reference_id === "string" ? object.client_reference_id : "");
  let notify: StripeApplyResult["notify"];
  const ownerEmails: StripeOwnerEmail[] = [];
  // Object box so assignments inside the transaction callback stay visible to the type checker.
  const pending: { mail: PendingOwnerMail | null; period: PendingPeriod | null } = {
    mail: null,
    period: null,
  };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { eventId, type: event.type ?? "unknown" } });
      if (event.type === "checkout.session.completed" && clientId) {
        const paymentStatus = typeof object.payment_status === "string" ? object.payment_status : "";
        if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") return;
        const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
        const client = await tx.client.findFirst({ where: { id: clientId, archivedAt: null } });
        if (!client || client.internal) return;
        const live = Boolean(client.phoneE164);
        await tx.client.update({
          where: { id: clientId },
          data: {
            billingStatus: "paid",
            paidAt: client.paidAt ?? now,
            pastDueSince: null,
            stripeSubscriptionId: subscriptionId ?? client.stripeSubscriptionId,
            status: live ? "live" : client.status,
            liveAt: live ? client.liveAt ?? now : client.liveAt,
          },
        });
        await recordChange(tx, {
          clientId,
          actor: WEBHOOK_ACTOR,
          action: "billing.paid",
          entityType: "client",
          entityId: clientId,
          summary: `Payment received for ${client.name}`,
          after: { billingStatus: "paid" },
        });
      }
      if (event.type === "checkout.session.expired" && clientId) {
        await tx.client.updateMany({
          where: { id: clientId, billingStatus: "checkout_open" },
          data: { stripeCheckoutUrl: null, stripeCheckoutExpiresAt: null },
        });
      }
      if (event.type === "invoice.payment_failed") {
        const customer = stripeCustomerId(object);
        const client = customer
          ? await tx.client.findFirst({ where: { stripeCustomerId: customer, archivedAt: null, internal: false } })
          : null;
        if (!client) return;
        await tx.client.update({
          where: { id: client.id },
          data: {
            billingStatus: "past_due",
            pastDueSince: client.pastDueSince ?? now,
          },
        });
        await recordChange(tx, {
          clientId: client.id,
          actor: WEBHOOK_ACTOR,
          action: "billing.past_due",
          entityType: "client",
          entityId: client.id,
          summary: `A payment failed for ${client.name}`,
          after: { billingStatus: "past_due", pastDueSince: (client.pastDueSince ?? now).toISOString() },
        });
        notify = {
          subject: `Payment failed for ${client.name}`,
          text: `Stripe reported a failed invoice for ${client.name}. The client is past due.`,
        };
        pending.mail = { clientId: client.id, portalOwnerEmail: client.portalOwnerEmail, kind: "payment_failed" };
      }
      if (event.type === "invoice.paid") {
        const customer = stripeCustomerId(object);
        const client = customer
          ? await tx.client.findFirst({ where: { stripeCustomerId: customer, archivedAt: null, internal: false } })
          : null;
        if (!client) return;
        const wasPaused = client.billingStatus === "paused";
        const wasPastDue = client.billingStatus === "past_due";
        if (wasPaused || wasPastDue) {
          await tx.client.update({
            where: { id: client.id },
            data: { billingStatus: "paid", pastDueSince: null },
          });
          await recordChange(tx, {
            clientId: client.id,
            actor: WEBHOOK_ACTOR,
            action: wasPaused ? "billing.resumed" : "billing.paid_again",
            entityType: "client",
            entityId: client.id,
            summary: wasPaused ? `Resumed ${client.name} after payment` : `Payment recovered for ${client.name}`,
            after: { billingStatus: "paid", pastDueSince: null },
          });
          pending.mail = { clientId: client.id, portalOwnerEmail: client.portalOwnerEmail, kind: "resumed" };
        }
      }
      if (event.type === "customer.subscription.updated") {
        const subscriptionId = typeof object.id === "string" ? object.id : "";
        if (!subscriptionId) return;
        const client = await tx.client.findFirst({ where: { stripeSubscriptionId: subscriptionId, archivedAt: null } });
        if (!client || client.internal) return;
        const bounds = periodBoundsFromSubscription(object);
        const cancelAtPeriodEnd = object.cancel_at_period_end === true;
        const data: {
          stripeCurrentPeriodStart?: Date;
          stripeCurrentPeriodEnd?: Date;
          billingStatus?: string;
          serviceEndsAt?: Date | null;
        } = {};
        if (bounds) {
          data.stripeCurrentPeriodStart = bounds.start;
          data.stripeCurrentPeriodEnd = bounds.end;
        }
        if (cancelAtPeriodEnd) {
          data.billingStatus = "cancel_scheduled";
          data.serviceEndsAt = bounds?.end ?? client.serviceEndsAt ?? now;
        } else if (client.billingStatus === "cancel_scheduled") {
          data.billingStatus = "paid";
          data.serviceEndsAt = null;
        }
        if (Object.keys(data).length > 0) {
          await tx.client.update({ where: { id: client.id }, data });
        }
        if (cancelAtPeriodEnd) {
          await recordChange(tx, {
            clientId: client.id,
            actor: WEBHOOK_ACTOR,
            action: "billing.cancel_scheduled",
            entityType: "client",
            entityId: client.id,
            summary: `Cancel at period end scheduled for ${client.name}`,
            after: {
              billingStatus: "cancel_scheduled",
              serviceEndsAt: data.serviceEndsAt instanceof Date ? data.serviceEndsAt.toISOString() : null,
            },
          });
        } else if (client.billingStatus === "cancel_scheduled") {
          await recordChange(tx, {
            clientId: client.id,
            actor: WEBHOOK_ACTOR,
            action: "billing.cancel_undone",
            entityType: "client",
            entityId: client.id,
            summary: `Cancel undone for ${client.name}`,
            after: { billingStatus: "paid", serviceEndsAt: null },
          });
        }
        pending.period = {
          clientId: client.id,
          prevStart: client.stripeCurrentPeriodStart,
          nextStart: bounds?.start ?? null,
        };
      }
      if (event.type === "customer.subscription.deleted") {
        const subscriptionId = typeof object.id === "string" ? object.id : "";
        if (!subscriptionId) return;
        const client = await tx.client.findFirst({ where: { stripeSubscriptionId: subscriptionId, archivedAt: null } });
        if (!client || client.status === "churned") return;
        const serviceEndsAt = unixDate(object.ended_at, now);
        await tx.client.update({
          where: { id: client.id },
          data: { billingStatus: "cancel_scheduled", serviceEndsAt },
        });
        await recordChange(tx, {
          clientId: client.id,
          actor: WEBHOOK_ACTOR,
          action: "billing.subscription_deleted",
          entityType: "client",
          entityId: client.id,
          summary: `Stripe canceled the subscription for ${client.name}`,
          after: { billingStatus: "cancel_scheduled", serviceEndsAt: serviceEndsAt.toISOString() },
        });
        notify = {
          subject: `Subscription canceled for ${client.name}`,
          text: `Stripe canceled the subscription for ${client.name}. Service is scheduled to stop.`,
        };
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return {};
    throw error;
  }

  if (pending.mail) {
    const to = await resolveOwnerEmail(pending.mail.clientId, pending.mail.portalOwnerEmail);
    if (to) {
      if (pending.mail.kind === "payment_failed") {
        ownerEmails.push({ to, ...paymentFailedOwnerEmail({ billingUrl: appBillingUrl() }) });
      } else {
        ownerEmails.push({ to, ...billingResumedOwnerEmail() });
      }
    }
  }

  if (pending.period) {
    await applyScheduledPlanChanges(pending.period.clientId, pending.period.prevStart, pending.period.nextStart, now);
  }

  return {
    ...(notify ? { notify } : {}),
    ...(ownerEmails.length > 0 ? { ownerEmails } : {}),
  };
}

export function formatTargetsFor(rows: Array<{ label: string; e164: string }>): string {
  return formatTransferTargets(rows);
}

export function weeklyHoursOf(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object") return null;
  return value as WeeklyHours;
}
