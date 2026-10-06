/**
 * Phase B Part 5: owner monthly reports and admin business report.
 * Data from UsageRecord + CallRecord metadata + ClientMessage counts only — never decrypt content.
 */
import { calendarMonthRange } from "@alinstra/agent";
import { getEnv } from "@alinstra/config";
import { monthlyReportOwnerEmail } from "@alinstra/email";
import type { Actor } from "./changes";
import { recordChange } from "./changes";
import { parseCallFlags } from "./call-flags";
import { prisma } from "./client";
import { officeOpen } from "./domain";
import { assertTenantContext, type TenantContext } from "./tenant";

export type YearMonth = { year: number; month: number };

export type BusiestCell = {
  weekday: number;
  hour: number;
  count: number;
};

export type OwnerMonthlyReport = {
  clientId: string;
  clientName: string;
  timezone: string;
  yearMonth: YearMonth;
  monthLabel: string;
  rangeStart: Date;
  rangeEnd: Date;
  callsAnswered: number;
  afterHoursCalls: number;
  messagesTaken: number;
  /** Booked outcomes only; ClientMessage has no appointment-request tag. */
  appointmentRequests: number;
  appointmentRequestsNote: string;
  transfers: number;
  minutesUsed: number;
  includedMinutes: number;
  averageCallLengthSeconds: number | null;
  flaggedCalls: number;
  busiestTimes: BusiestCell[];
  monthlyReportEmail: boolean;
};

export type AdminReportRow = {
  clientId: string;
  clientName: string;
  internal: boolean;
  planName: string | null;
  monthlyPriceCents: number;
  minutesUsed: number;
  includedMinutes: number;
  overageMinutes: number;
  overageCents: number;
  retellCostCents: number;
  revenueCents: number;
  grossMarginCents: number;
  grossMarginPercent: number | null;
  calls: number;
  messages: number;
  flaggedCalls: number;
  billingStatus: string;
};

export type AdminBusinessReport = {
  yearMonth: YearMonth;
  monthLabel: string;
  rangeNote: string;
  clients: AdminReportRow[];
  internal: AdminReportRow[];
  revenueDisclaimer: string;
};

export type MonthlyReportEmailReport = {
  scanned: number;
  sent: number;
  skipped: number;
  ownerEmails: Array<{ to: string; subject: string; text: string }>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const APPOINTMENT_REQUESTS_NOTE =
  "Counts calls with a booked outcome. Messages are not tagged as appointment requests.";

const REVENUE_DISCLAIMER = "Estimated. Stripe invoices are the record.";

function zoneParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number; hour: number } {
  let zone = timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(date);
  } catch {
    zone = "America/New_York";
  }
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const weekdayName = (bag.weekday ?? "Sun").slice(0, 3);
  const weekday = Math.max(0, WEEKDAYS.indexOf(weekdayName as (typeof WEEKDAYS)[number]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday,
    hour,
  };
}

export function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function monthLabelOf(ym: YearMonth): string {
  return `${MONTH_NAMES[ym.month - 1] ?? ym.month} ${ym.year}`;
}

export function parseYearMonth(value: string | null | undefined): YearMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Previous complete calendar month in the client's timezone. */
export function lastFullYearMonth(timezone: string, now = new Date()): YearMonth {
  const { start } = calendarMonthRange(timezone, now);
  const previous = new Date(start.getTime() - 1);
  const parts = zoneParts(previous, timezone);
  return { year: parts.year, month: parts.month };
}

/** UTC instant range for a calendar month in the given timezone. */
export function yearMonthRange(timezone: string, ym: YearMonth): { start: Date; end: Date } {
  const probe = new Date(Date.UTC(ym.year, ym.month - 1, 15, 17, 0, 0));
  return calendarMonthRange(timezone, probe);
}

/** Month options for a picker: last 24 full months ending at `last`. */
export function monthPickerOptions(last: YearMonth, count = 24): YearMonth[] {
  const out: YearMonth[] = [];
  let year = last.year;
  let month = last.month;
  for (let i = 0; i < count; i += 1) {
    out.push({ year, month });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function effectiveMonthly(client: { overrideMonthlyPriceCents: number | null }, plan: { monthlyPriceCents: number } | null): number {
  if (!plan) return 0;
  return client.overrideMonthlyPriceCents ?? plan.monthlyPriceCents;
}

function effectiveIncluded(client: { overrideIncludedMinutes: number | null }, plan: { includedMinutes: number } | null): number {
  if (!plan) return 0;
  return client.overrideIncludedMinutes ?? plan.includedMinutes;
}

function effectiveOverage(
  client: { overrideOveragePerMinuteCents: number | null },
  plan: { overagePerMinuteCents: number } | null,
): number {
  if (!plan) return 0;
  return client.overrideOveragePerMinuteCents ?? plan.overagePerMinuteCents;
}

export function grossMarginOf(input: {
  monthlyPriceCents: number;
  overageCents: number;
  retellCostCents: number;
}): { revenueCents: number; grossMarginCents: number; grossMarginPercent: number | null } {
  const revenueCents = input.monthlyPriceCents + input.overageCents;
  const grossMarginCents = revenueCents - input.retellCostCents;
  const grossMarginPercent = revenueCents > 0 ? Math.round((grossMarginCents / revenueCents) * 1000) / 10 : null;
  return { revenueCents, grossMarginCents, grossMarginPercent };
}

export function buildBusiestTimes(
  calls: Array<{ startedAt: Date | null }>,
  timezone: string,
): BusiestCell[] {
  const counts = new Map<string, BusiestCell>();
  for (const call of calls) {
    if (!call.startedAt) continue;
    const parts = zoneParts(call.startedAt, timezone);
    const key = `${parts.weekday}-${parts.hour}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { weekday: parts.weekday, hour: parts.hour, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour);
}

function reportUrl(yearMonth: YearMonth): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/home/reports?month=${formatYearMonth(yearMonth)}`;
}

async function ownerEmailForClient(clientId: string, portalOwnerEmail: string | null): Promise<string | null> {
  if (portalOwnerEmail?.trim()) return portalOwnerEmail.trim().toLowerCase();
  const owner = await prisma.user.findFirst({
    where: { clientId, role: "client_owner" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return owner?.email?.trim().toLowerCase() || null;
}

async function computeOwnerMetrics(
  client: {
    id: string;
    name: string;
    timezone: string;
    weeklyHours: unknown;
    monthlyReportEmail: boolean;
    overrideIncludedMinutes: number | null;
    plan: { includedMinutes: number } | null;
  },
  ym: YearMonth,
): Promise<OwnerMonthlyReport> {
  const timezone = client.timezone || "America/New_York";
  const { start, end } = yearMonthRange(timezone, ym);
  const [calls, messagesTaken, usageRows] = await Promise.all([
    prisma.callRecord.findMany({
      where: { clientId: client.id, startedAt: { gte: start, lt: end } },
      select: { startedAt: true, durationSeconds: true, outcome: true, flags: true },
    }),
    prisma.clientMessage.count({
      where: { clientId: client.id, createdAt: { gte: start, lt: end } },
    }),
    prisma.usageRecord.findMany({
      where: { clientId: client.id, startedAt: { gte: start, lt: end } },
      select: { billableMinutes: true },
    }),
  ]);

  let afterHoursCalls = 0;
  let transfers = 0;
  let appointmentRequests = 0;
  let flaggedCalls = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const call of calls) {
    if (call.startedAt && !officeOpen(client.weeklyHours, timezone, call.startedAt)) afterHoursCalls += 1;
    if (call.outcome === "transferred") transfers += 1;
    if (call.outcome === "booked") appointmentRequests += 1;
    if (parseCallFlags(call.flags).length > 0) flaggedCalls += 1;
    if (typeof call.durationSeconds === "number" && call.durationSeconds >= 0) {
      durationSum += call.durationSeconds;
      durationCount += 1;
    }
  }

  const minutesUsed = usageRows.reduce((sum, row) => sum + row.billableMinutes, 0);
  const includedMinutes = effectiveIncluded(client, client.plan);

  return {
    clientId: client.id,
    clientName: client.name,
    timezone,
    yearMonth: ym,
    monthLabel: monthLabelOf(ym),
    rangeStart: start,
    rangeEnd: end,
    callsAnswered: calls.length,
    afterHoursCalls,
    messagesTaken,
    appointmentRequests,
    appointmentRequestsNote: APPOINTMENT_REQUESTS_NOTE,
    transfers,
    minutesUsed,
    includedMinutes,
    averageCallLengthSeconds: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    flaggedCalls,
    busiestTimes: buildBusiestTimes(calls, timezone),
    monthlyReportEmail: client.monthlyReportEmail,
  };
}

export async function ownerMonthlyReport(
  ctx: TenantContext,
  clientId: string,
  ym: YearMonth,
): Promise<OwnerMonthlyReport> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && ctx.clientId !== clientId) throw new Error("Wrong client.");
  if (ctx.role === "client_staff") throw new Error("Only the owner can view reports.");

  const client = await prisma.client.findFirstOrThrow({
    where: { id: clientId, archivedAt: null },
    select: {
      id: true,
      name: true,
      timezone: true,
      weeklyHours: true,
      monthlyReportEmail: true,
      overrideIncludedMinutes: true,
      plan: { select: { includedMinutes: true } },
    },
  });
  return computeOwnerMetrics(client, ym);
}

function buildAdminRow(input: {
  clientId: string;
  clientName: string;
  internal: boolean;
  planName: string | null;
  monthlyPriceCents: number;
  includedMinutes: number;
  overagePerMinuteCents: number;
  minutesUsed: number;
  retellCostCents: number;
  calls: number;
  messages: number;
  flaggedCalls: number;
  billingStatus: string;
}): AdminReportRow {
  const overageMinutes = Math.max(0, input.minutesUsed - input.includedMinutes);
  const overageCents = overageMinutes * input.overagePerMinuteCents;
  const margin = grossMarginOf({
    monthlyPriceCents: input.internal ? 0 : input.monthlyPriceCents,
    overageCents: input.internal ? 0 : overageCents,
    retellCostCents: input.retellCostCents,
  });
  return {
    clientId: input.clientId,
    clientName: input.clientName,
    internal: input.internal,
    planName: input.planName,
    monthlyPriceCents: input.internal ? 0 : input.monthlyPriceCents,
    minutesUsed: input.minutesUsed,
    includedMinutes: input.includedMinutes,
    overageMinutes: input.internal ? 0 : overageMinutes,
    overageCents: input.internal ? 0 : overageCents,
    retellCostCents: input.retellCostCents,
    revenueCents: margin.revenueCents,
    grossMarginCents: margin.grossMarginCents,
    grossMarginPercent: margin.grossMarginPercent,
    calls: input.calls,
    messages: input.messages,
    flaggedCalls: input.flaggedCalls,
    billingStatus: input.billingStatus,
  };
}

export async function adminBusinessReport(ctx: TenantContext, ym: YearMonth): Promise<AdminBusinessReport> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Admin only.");

  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      internal: true,
      timezone: true,
      billingStatus: true,
      overrideMonthlyPriceCents: true,
      overrideIncludedMinutes: true,
      overrideOveragePerMinuteCents: true,
      plan: { select: { name: true, monthlyPriceCents: true, includedMinutes: true, overagePerMinuteCents: true } },
    },
    orderBy: { name: "asc" },
  });

  const billed: AdminReportRow[] = [];
  const internal: AdminReportRow[] = [];

  for (const client of clients) {
    const timezone = client.timezone || "America/New_York";
    const { start, end } = yearMonthRange(timezone, ym);
    const [usageRows, calls, messages, flagged] = await Promise.all([
      prisma.usageRecord.findMany({
        where: { clientId: client.id, startedAt: { gte: start, lt: end } },
        select: { billableMinutes: true, costCents: true },
      }),
      prisma.callRecord.count({
        where: { clientId: client.id, startedAt: { gte: start, lt: end } },
      }),
      prisma.clientMessage.count({
        where: { clientId: client.id, createdAt: { gte: start, lt: end } },
      }),
      prisma.callRecord.findMany({
        where: { clientId: client.id, startedAt: { gte: start, lt: end } },
        select: { flags: true },
      }),
    ]);

    const minutesUsed = usageRows.reduce((sum, row) => sum + row.billableMinutes, 0);
    const retellCostCents = usageRows.reduce((sum, row) => sum + (row.costCents ?? 0), 0);
    const flaggedCalls = flagged.filter((row) => parseCallFlags(row.flags).length > 0).length;
    const row = buildAdminRow({
      clientId: client.id,
      clientName: client.name,
      internal: client.internal,
      planName: client.plan?.name ?? null,
      monthlyPriceCents: effectiveMonthly(client, client.plan),
      includedMinutes: effectiveIncluded(client, client.plan),
      overagePerMinuteCents: effectiveOverage(client, client.plan),
      minutesUsed,
      retellCostCents,
      calls,
      messages,
      flaggedCalls,
      billingStatus: client.billingStatus,
    });
    if (client.internal) internal.push(row);
    else billed.push(row);
  }

  return {
    yearMonth: ym,
    monthLabel: monthLabelOf(ym),
    rangeNote: "Per-client calendar month in that client's timezone.",
    clients: billed,
    internal,
    revenueDisclaimer: REVENUE_DISCLAIMER,
  };
}

/**
 * Monthly owner report emails.
 * Schedule: single run on the 1st of each month at 09:00 America/New_York (not per-client local 09:00).
 * Reports the previous calendar month in each client's timezone. Internal clients and opted-out owners are skipped.
 */
export async function sendMonthlyReportEmails(now = new Date()): Promise<MonthlyReportEmailReport> {
  const report: MonthlyReportEmailReport = { scanned: 0, sent: 0, skipped: 0, ownerEmails: [] };
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, internal: false, monthlyReportEmail: true },
    select: {
      id: true,
      name: true,
      timezone: true,
      weeklyHours: true,
      monthlyReportEmail: true,
      portalOwnerEmail: true,
      overrideIncludedMinutes: true,
      plan: { select: { includedMinutes: true } },
    },
  });

  for (const client of clients) {
    report.scanned += 1;
    const timezone = client.timezone || "America/New_York";
    const ym = lastFullYearMonth(timezone, now);
    const metrics = await computeOwnerMetrics(client, ym);
    if (metrics.callsAnswered === 0) {
      report.skipped += 1;
      continue;
    }
    const to = await ownerEmailForClient(client.id, client.portalOwnerEmail);
    if (!to) {
      report.skipped += 1;
      continue;
    }
    const mail = monthlyReportOwnerEmail({
      monthLabel: metrics.monthLabel,
      callsAnswered: metrics.callsAnswered,
      messagesTaken: metrics.messagesTaken,
      minutesUsed: metrics.minutesUsed,
      includedMinutes: metrics.includedMinutes,
      reportUrl: reportUrl(ym),
    });
    report.ownerEmails.push({ to, ...mail });
    report.sent += 1;
  }

  return report;
}

export async function setMonthlyReportEmail(
  ctx: Actor,
  input: { clientId: string; enabled: boolean },
): Promise<void> {
  assertTenantContext(ctx);
  if (ctx.role === "client_staff") throw new Error("Only the client owner can change report email settings.");
  if (ctx.role !== "admin" && ctx.clientId !== input.clientId) throw new Error("That client is not available.");

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, archivedAt: null },
    select: { id: true, monthlyReportEmail: true },
  });
  if (!client) throw new Error("That client is not available.");
  if (client.monthlyReportEmail === input.enabled) return;

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: client.id }, data: { monthlyReportEmail: input.enabled } });
    await recordChange(tx, {
      clientId: client.id,
      actor: ctx,
      action: "reports.monthly_email_changed",
      entityType: "client",
      entityId: client.id,
      summary: input.enabled ? "Monthly report email turned on" : "Monthly report email turned off",
      before: { monthlyReportEmail: client.monthlyReportEmail },
      after: { monthlyReportEmail: input.enabled },
    });
  });
}

export { WEEKDAYS, APPOINTMENT_REQUESTS_NOTE, REVENUE_DISCLAIMER };
