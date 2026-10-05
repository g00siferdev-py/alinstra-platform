import { prisma } from "./client";
import { assertTenantContext, type TenantContext } from "./tenant";

const LIVE_WINDOW_MS = 20 * 60 * 1000;

export type OwnerOverview = {
  clientName: string;
  timezone: string;
  planName: string | null;
  minutesIncluded: number;
  minutesUsed: number;
  callsThisWeek: number;
  messagesThisWeek: number;
  publicPhone: string | null;
  agentLive: boolean;
  liveCallId: string | null;
};

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function ownerOverview(ctx: TenantContext, clientId: string, now = new Date()): Promise<OwnerOverview> {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && ctx.clientId !== clientId) {
    throw new Error("Wrong client.");
  }

  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const liveSince = new Date(now.getTime() - LIVE_WINDOW_MS);

  const [client, callsThisWeek, messagesThisWeek, monthDurations, liveCall] = await Promise.all([
    prisma.client.findFirstOrThrow({
      where: { id: clientId, archivedAt: null },
      include: { plan: { select: { name: true, includedMinutes: true } } },
    }),
    prisma.callRecord.count({
      where: { clientId, startedAt: { gte: weekStart }, purgedAt: null },
    }),
    prisma.clientMessage.count({
      where: { clientId, createdAt: { gte: weekStart } },
    }),
    prisma.callRecord.findMany({
      where: { clientId, startedAt: { gte: monthStart }, purgedAt: null, durationSeconds: { not: null } },
      select: { durationSeconds: true },
    }),
    prisma.callRecord.findFirst({
      where: {
        clientId,
        startedAt: { gte: liveSince },
        endedAt: null,
        purgedAt: null,
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    }),
  ]);

  const minutesUsed = monthDurations.reduce((sum, row) => sum + Math.ceil((row.durationSeconds ?? 0) / 60), 0);
  const minutesIncluded = client.overrideIncludedMinutes ?? client.plan?.includedMinutes ?? 0;

  return {
    clientName: client.name,
    timezone: client.timezone,
    planName: client.plan?.name ?? null,
    minutesIncluded,
    minutesUsed,
    callsThisWeek,
    messagesThisWeek,
    publicPhone: client.publicPhone ?? client.phoneE164,
    agentLive: Boolean(liveCall),
    liveCallId: liveCall?.id ?? null,
  };
}
