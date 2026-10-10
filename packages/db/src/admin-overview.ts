import { parseCallFlags } from "./call-flags";
import type { Actor } from "./changes";
import { prisma } from "./client";
import { Prisma } from "./generated/prisma/client";
import { assertTenantContext } from "./tenant";

const LIVE_WINDOW_MS = 20 * 60 * 1000;

export type LiveCallRow = {
  id: string;
  clientId: string;
  clientName: string;
  callerMasked: string;
  startedAt: Date;
  statusLine: string;
};

export type AdminTodoItem = {
  id: string;
  kind: "held_edit" | "failed_recording" | "flagged_call" | "lead" | "setup" | "self_serve_review" | "paused" | "plan_change";
  title: string;
  detail: string;
  href: string;
};

export type AdminClientRow = {
  id: string;
  name: string;
  initials: string;
  status: "on_a_call" | "live" | "setting_up" | "draft" | "paused";
  statusLabel: string;
  planName: string | null;
  minutesUsed: number;
  minutesIncluded: number;
  interviewProgress: number | null;
  continueHref: string | null;
};

export type AdminLatestCall = {
  id: string;
  clientId: string;
  clientName: string;
  startedAt: Date | null;
  durationSeconds: number | null;
  outcome: string | null;
  summarySnippet: string;
  flagged: boolean;
};

export type AdminOverview = {
  liveCalls: LiveCallRow[];
  stats: {
    callsToday: number;
    messagesToday: number;
    minutesThisMonth: number;
    todoCount: number;
  };
  todos: AdminTodoItem[];
  clients: AdminClientRow[];
  latestCalls: AdminLatestCall[];
  startInterviewHref: string;
};

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "??";
}

function assertAdmin(ctx: Actor): void {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only admin can load the overview.");
}

export async function listLiveCalls(ctx: Actor, now = new Date()): Promise<LiveCallRow[]> {
  assertAdmin(ctx);
  const since = new Date(now.getTime() - LIVE_WINDOW_MS);
  const rows = await prisma.callRecord.findMany({
    where: {
      startedAt: { gte: since },
      endedAt: null,
      purgedAt: null,
      client: { archivedAt: null },
    },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { client: { select: { id: true, name: true } } },
  });
  return rows
    .filter((row): row is typeof row & { startedAt: Date } => Boolean(row.startedAt))
    .map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      callerMasked: row.callerMasked,
      startedAt: row.startedAt,
      statusLine: "Ava is on the line",
    }));
}

export async function adminOverview(ctx: Actor, now = new Date()): Promise<AdminOverview> {
  assertAdmin(ctx);
  const dayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const liveCalls = await listLiveCalls(ctx, now);
  const liveClientIds = new Set(liveCalls.map((row) => row.clientId));

  const [
    callsToday,
    messagesToday,
    monthDurations,
    held,
    pending,
    failedRecordings,
    flaggedCalls,
    uncontactedLeads,
    selfServeAwaitingReview,
    pausedClients,
    planChangeRequests,
    clients,
    latestCallRows,
    activeInterviews,
  ] = await Promise.all([
    prisma.callRecord.count({ where: { startedAt: { gte: dayStart }, purgedAt: null } }),
    prisma.clientMessage.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.usageRecord.findMany({
      where: { startedAt: { gte: monthStart } },
      select: { clientId: true, billableMinutes: true },
    }),
    prisma.quickUpdate.findMany({
      where: { status: "held" },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    prisma.changeRequest.findMany({
      where: { status: "pending" },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    prisma.callRecord.findMany({
      where: { recordingStatus: "failed", purgedAt: null },
      take: 10,
      orderBy: { updatedAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    prisma.callRecord.findMany({
      where: { purgedAt: null, flags: { not: Prisma.DbNull } },
      take: 20,
      orderBy: { updatedAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    prisma.lead.findMany({
      where: { contactedAt: null },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({
      where: {
        archivedAt: null,
        selfServe: true,
        wizardSubmittedAt: { not: null },
        status: { notIn: ["live", "churned"] },
      },
      take: 10,
      orderBy: { wizardSubmittedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.client.findMany({
      where: { archivedAt: null, internal: false, billingStatus: "paused" },
      take: 20,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, pastDueSince: true },
    }),
    prisma.planChangeRequest.findMany({
      where: { status: { in: ["pending", "scheduled"] } },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        toPlan: { select: { name: true } },
        fromPlan: { select: { name: true } },
      },
    }),
    prisma.client.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 12,
      include: {
        plan: { select: { name: true, includedMinutes: true } },
        wizardDraft: { select: { currentStep: true, discardedAt: true } },
      },
    }),
    prisma.callRecord.findMany({
      where: { purgedAt: null, endedAt: { not: null } },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { client: { select: { id: true, name: true } } },
    }),
    prisma.interviewSession.findMany({
      where: { status: "active" },
      select: { clientId: true, state: true },
    }),
  ]);

  const minutesByClient = new Map<string, number>();
  let minutesThisMonth = 0;
  for (const row of monthDurations) {
    minutesThisMonth += row.billableMinutes;
    minutesByClient.set(row.clientId, (minutesByClient.get(row.clientId) ?? 0) + row.billableMinutes);
  }

  const interviewByClient = new Map<string, number>();
  for (const session of activeInterviews) {
    if (!session.clientId) continue;
    const state = session.state as { answeredQuestions?: string[]; openQuestions?: string[] };
    const answered = state.answeredQuestions?.length ?? 0;
    const open = state.openQuestions?.length ?? 0;
    const total = answered + open;
    interviewByClient.set(session.clientId, total > 0 ? Math.round((answered / total) * 100) : 0);
  }

  const todos: AdminTodoItem[] = [];
  for (const row of pending) {
    todos.push({
      id: `cr-${row.id}`,
      kind: "held_edit",
      title: `Approve ${row.client.name}'s change`,
      detail: `Pending ${row.category} request needs a review.`,
      href: `/admin/clients/${row.clientId}/changes`,
    });
  }
  for (const row of held) {
    todos.push({
      id: `qu-${row.id}`,
      kind: "held_edit",
      title: `Approve ${row.client.name}'s voice change`,
      detail: `A held ${row.kind} update is waiting for an admin.`,
      href: `/admin/clients/${row.clientId}/changes`,
    });
  }
  for (const row of failedRecordings) {
    todos.push({
      id: `rec-${row.id}`,
      kind: "failed_recording",
      title: "Retry a recording",
      detail: `${row.client.name} has a recording that failed to copy.`,
      href: `/admin/clients/${row.clientId}/calls/${row.id}`,
    });
  }
  for (const row of flaggedCalls) {
    const flags = parseCallFlags(row.flags);
    if (flags.length === 0) continue;
    todos.push({
      id: `flag-${row.id}`,
      kind: "flagged_call",
      title: `Review a flagged call`,
      detail: `${row.client.name} has ${flags.length} flag${flags.length === 1 ? "" : "s"} on a recent call.`,
      href: `/admin/clients/${row.clientId}/calls/${row.id}`,
    });
  }
  for (const lead of uncontactedLeads) {
    todos.push({
      id: `lead-${lead.id}`,
      kind: "lead",
      title: "Call back a new lead",
      detail: `${lead.business || lead.name} has not been contacted yet.`,
      href: "/admin/leads",
    });
  }
  for (const client of selfServeAwaitingReview) {
    todos.push({
      id: `ss-${client.id}`,
      kind: "self_serve_review",
      title: "Held for review",
      detail: `${client.name} submitted their setup and is waiting for review.`,
      href: `/admin/clients/${client.id}`,
    });
  }
  for (const client of pausedClients) {
    todos.push({
      id: `paused-${client.id}`,
      kind: "paused",
      title: `${client.name} is paused`,
      detail: "Past due more than 7 days — Ava is not answering until the card is updated.",
      href: `/admin/clients/${client.id}`,
    });
  }
  for (const row of planChangeRequests) {
    todos.push({
      id: `pcr-${row.id}`,
      kind: "plan_change",
      title:
        row.status === "pending"
          ? `Approve ${row.client.name}'s plan change`
          : `${row.client.name}'s downgrade is scheduled`,
      detail: `${row.fromPlan.name} → ${row.toPlan.name} (${row.direction}).`,
      href: `/admin/clients/${row.clientId}/billing`,
    });
  }
  for (const client of clients) {
    const draft = client.wizardDraft;
    const midWizard = Boolean(draft && !draft.discardedAt && !client.wizardSubmittedAt);
    const interviewPct = interviewByClient.get(client.id);
    if (midWizard || interviewPct !== undefined) {
      todos.push({
        id: `setup-${client.id}`,
        kind: "setup",
        title: `Continue ${client.name}`,
        detail:
          interviewPct !== undefined
            ? `Interview about ${interviewPct}% done.`
            : "Wizard setup is still in progress.",
        href:
          interviewPct !== undefined
            ? `/admin/clients/${client.id}/interview`
            : `/admin/clients/${client.id}/wizard`,
      });
    }
  }

  const clientRows: AdminClientRow[] = clients.slice(0, 8).map((client) => {
    const included = client.overrideIncludedMinutes ?? client.plan?.includedMinutes ?? 0;
    const used = minutesByClient.get(client.id) ?? 0;
    const interviewPct = interviewByClient.get(client.id) ?? null;
    const midWizard = Boolean(client.wizardDraft && !client.wizardDraft.discardedAt && !client.wizardSubmittedAt);
    let status: AdminClientRow["status"] = "live";
    let statusLabel = "Live";
    let continueHref: string | null = null;
    if (liveClientIds.has(client.id)) {
      status = "on_a_call";
      statusLabel = "On a call";
    } else if (client.billingStatus === "paused") {
      status = "paused";
      statusLabel = "Paused";
    } else if (interviewPct !== null || midWizard) {
      status = "setting_up";
      statusLabel =
        interviewPct !== null ? `Setting up · interview ${interviewPct}% done` : "Setting up";
      continueHref =
        interviewPct !== null ? `/admin/clients/${client.id}/interview` : `/admin/clients/${client.id}/wizard`;
    } else if (!client.wizardSubmittedAt) {
      status = "draft";
      statusLabel = "Draft";
      continueHref = `/admin/clients/${client.id}/wizard`;
    }
    return {
      id: client.id,
      name: client.name,
      initials: initials(client.name),
      status,
      statusLabel,
      planName: client.plan?.name ?? null,
      minutesUsed: used,
      minutesIncluded: included,
      interviewProgress: interviewPct,
      continueHref,
    };
  });

  const setupTodo = todos.find((item) => item.kind === "setup");
  const startInterviewHref = setupTodo?.href.endsWith("/interview")
    ? setupTodo.href
    : "/admin/interview";

  return {
    liveCalls,
    stats: {
      callsToday,
      messagesToday,
      minutesThisMonth,
      todoCount: todos.length,
    },
    todos: todos.slice(0, 12),
    clients: clientRows,
    latestCalls: latestCallRows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      startedAt: row.startedAt,
      durationSeconds: row.durationSeconds,
      outcome: row.outcome,
      summarySnippet: row.endReason ? `${row.client.name} · ${row.endReason}` : row.client.name,
      flagged: parseCallFlags(row.flags).length > 0,
    })),
    startInterviewHref,
  };
}
