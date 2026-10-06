import { prisma } from "./client";
import type { Prisma } from "./generated/prisma/client";
import { assertTenantContext, type TenantContext } from "./tenant";

/**
 * Read-access audit log (Phase S part 2). Every place that shows a transcript, recording, message, or
 * document writes one row. Rows hold ids, counts, and request metadata only; never call or message text.
 */

export const ACCESS_ACTIONS = [
  "call.transcript.view",
  "call.recording.stream",
  "call.raw.view",
  "message.list",
  "message.view",
  "knowledge.document.download",
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const ACCESS_ACTION_LABELS: Record<AccessAction, string> = {
  "call.transcript.view": "Viewed a call transcript",
  "call.recording.stream": "Played a call recording",
  "call.raw.view": "Viewed raw call events",
  "message.list": "Viewed messages",
  "message.view": "Opened a message",
  "knowledge.document.download": "Downloaded a document",
};

export function accessActionLabel(action: string): string {
  return (ACCESS_ACTION_LABELS as Record<string, string>)[action] ?? action;
}

export function isAccessAction(value: string | null | undefined): value is AccessAction {
  return typeof value === "string" && (ACCESS_ACTIONS as readonly string[]).includes(value);
}

/** Rows older than this are deleted by the nightly purge. */
export const ACCESS_LOG_RETENTION_DAYS = 400;
export const ACCESS_LOG_PAGE_SIZE = 50;
export const ACCESS_LOG_EXPORT_MAX = 10_000;
const USER_AGENT_MAX = 200;
const IP_MAX = 64;

/** What owners see for any Alinstra admin. */
export const SUPPORT_LABEL = "Alinstra support";

export type AccessEntry = {
  actorUserId: string;
  actorRole: "admin" | "client_owner" | "client_staff";
  clientId: string;
  action: AccessAction;
  entityType: string;
  entityId: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Reserved for admin "view as client"; always false until that exists. */
  impersonating?: boolean;
  /** List views: how many items were shown. */
  count?: number | null;
};

/** Ids only. Never a body, a name, a number, or the underlying database error message. */
export type AccessFailureIds = { actorUserId: string; clientId: string; action: string; entityType: string; entityId: string };

export type RecordAccessOptions = {
  /** Called when the insert fails (reports to Sentry in the web app). Must not throw; if it does, it is swallowed. */
  onError?: (error: unknown, ids: AccessFailureIds) => void;
  /**
   * Returns true when this access should be written, false when an equivalent row was written recently
   * (recordings: one row per call per actor per 10 minutes). If it throws, the row is written anyway.
   */
  shouldWrite?: () => Promise<boolean>;
};

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Awaited and best-effort: a failed insert is reported with ids only and the caller still serves the page.
 * Returns whether a row was written.
 */
export async function recordAccess(entry: AccessEntry, options: RecordAccessOptions = {}): Promise<boolean> {
  const ids: AccessFailureIds = {
    actorUserId: entry.actorUserId,
    clientId: entry.clientId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
  };
  try {
    if (options.shouldWrite) {
      let write = true;
      try {
        write = await options.shouldWrite();
      } catch {
        write = true;
      }
      if (!write) return false;
    }
    await prisma.accessLog.create({
      data: {
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        clientId: entry.clientId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ip: truncate(entry.ip, IP_MAX),
        userAgent: truncate(entry.userAgent, USER_AGENT_MAX),
        impersonating: entry.impersonating ?? false,
        count: entry.count ?? null,
      },
    });
    return true;
  } catch (error) {
    try {
      options.onError?.(error, ids);
    } catch {
      // Reporting must never break the page being served.
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type AccessLogFilter = {
  /** Admin only; owners are always pinned to their own client. */
  clientId?: string | null;
  /** Admin only. A user id, or part of an email address. */
  actor?: string | null;
  action?: AccessAction | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
};

export type AccessLogRow = {
  id: string;
  at: Date;
  /** Empty for owners looking at admin rows. */
  actorUserId: string;
  actorRole: string;
  /** Name for admin view ("Dana (dana@x.com)"); name only for staff in the owner view; "Alinstra support" for admins. */
  actorLabel: string;
  clientId: string;
  clientName: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string;
  /** Null in the owner view. */
  ip: string | null;
  userAgent: string | null;
  impersonating: boolean;
  count: number | null;
};

export type AccessLogPage = { rows: AccessLogRow[]; total: number; page: number; pageSize: number };

function scopeWhere(ctx: TenantContext, filter: AccessLogFilter): Prisma.AccessLogWhereInput | null {
  assertTenantContext(ctx);
  if (ctx.role === "client_staff") throw new Error("Only owners and admins can read the access log.");
  const where: Prisma.AccessLogWhereInput = {};
  if (ctx.role === "admin") {
    if (ctx.clientId) where.clientId = ctx.clientId;
    else if (filter.clientId) where.clientId = filter.clientId;
    if (ctx.clientId && filter.clientId && filter.clientId !== ctx.clientId) return null;
  } else {
    // Owners: always their own client, whatever the caller passed.
    where.clientId = ctx.clientId;
  }
  if (filter.action) where.action = filter.action;
  if (filter.from || filter.to) {
    where.at = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
  }
  return where;
}

async function actorIdsMatching(text: string): Promise<string[]> {
  const needle = text.trim();
  if (!needle) return [];
  const users = await prisma.user.findMany({
    where: { OR: [{ id: needle }, { email: { contains: needle, mode: "insensitive" } }] },
    select: { id: true },
    take: 200,
  });
  const ids = new Set(users.map((user) => user.id));
  ids.add(needle);
  return [...ids];
}

async function decorate(ctx: TenantContext, rows: Array<Prisma.AccessLogGetPayload<object>>): Promise<AccessLogRow[]> {
  const userIds = [...new Set(rows.map((row) => row.actorUserId))];
  const clientIds = [...new Set(rows.map((row) => row.clientId))];
  const [users, clients] = await Promise.all([
    userIds.length > 0 ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    clientIds.length > 0 ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const clientById = new Map(clients.map((client) => [client.id, client.name]));
  const isAdminView = ctx.role === "admin";
  return rows.map((row) => {
    const user = userById.get(row.actorUserId);
    let actorLabel: string;
    if (isAdminView) {
      actorLabel = user ? (user.name && user.name !== user.email ? `${user.name} (${user.email})` : user.email) : "Removed user";
    } else if (row.actorRole === "admin") {
      actorLabel = SUPPORT_LABEL;
    } else {
      actorLabel = user ? user.name || user.email : "Former team member";
    }
    return {
      id: row.id,
      at: row.at,
      actorUserId: isAdminView || row.actorRole !== "admin" ? row.actorUserId : "",
      actorRole: row.actorRole,
      actorLabel,
      clientId: row.clientId,
      clientName: clientById.get(row.clientId) ?? "Removed client",
      action: row.action,
      actionLabel: accessActionLabel(row.action),
      entityType: row.entityType,
      entityId: row.entityId,
      ip: isAdminView ? row.ip : null,
      userAgent: isAdminView ? row.userAgent : null,
      impersonating: row.impersonating,
      count: row.count,
    };
  });
}

/**
 * Tenant-scoped reader. Admins may filter by any client; owners are pinned to their own client and see
 * admins only as "Alinstra support" (no ids, no IP); staff are refused.
 */
export function accessLogs(ctx: TenantContext) {
  assertTenantContext(ctx);
  return {
    async list(filter: AccessLogFilter = {}): Promise<AccessLogPage> {
      const pageSize = Math.min(Math.max(filter.pageSize ?? ACCESS_LOG_PAGE_SIZE, 1), 200);
      const page = Math.max(Math.floor(filter.page ?? 1), 1);
      const base = scopeWhere(ctx, filter);
      if (!base) return { rows: [], total: 0, page, pageSize };
      const where = await withActor(ctx, base, filter);
      if (!where) return { rows: [], total: 0, page, pageSize };
      const [total, rows] = await Promise.all([
        prisma.accessLog.count({ where }),
        prisma.accessLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { rows: await decorate(ctx, rows), total, page, pageSize };
    },
    /** Every row matching the filter, newest first, capped. Admin only (CSV export). */
    async exportRows(filter: AccessLogFilter = {}, max = ACCESS_LOG_EXPORT_MAX): Promise<AccessLogRow[]> {
      if (ctx.role !== "admin") throw new Error("Only admins can export the access log.");
      const base = scopeWhere(ctx, filter);
      if (!base) return [];
      const where = await withActor(ctx, base, filter);
      if (!where) return [];
      const rows = await prisma.accessLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.min(max, ACCESS_LOG_EXPORT_MAX) });
      return decorate(ctx, rows);
    },
  };
}

async function withActor(ctx: TenantContext, base: Prisma.AccessLogWhereInput, filter: AccessLogFilter): Promise<Prisma.AccessLogWhereInput | null> {
  if (ctx.role !== "admin" || !filter.actor?.trim()) return base;
  const ids = await actorIdsMatching(filter.actor);
  if (ids.length === 0) return null;
  return { ...base, actorUserId: { in: ids } };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Deletes rows older than 400 days (exactly 400 days old is kept). Returns how many were removed. */
export async function purgeAccessLogs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCESS_LOG_RETENTION_DAYS * 86_400_000);
  const result = await prisma.accessLog.deleteMany({ where: { at: { lt: cutoff } } });
  return result.count;
}
