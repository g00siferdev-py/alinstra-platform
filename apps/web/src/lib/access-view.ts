/** Pure helpers for the access-history screens and CSV export. No database access; tested directly. */

import type { AccessAction, AccessLogRow } from "@alinstra/db";

// Type-only import above keeps this file free of database access; the Record makes the list exhaustive.
const ACTION_KEYS: Record<AccessAction, true> = {
  "call.transcript.view": true,
  "call.recording.stream": true,
  "call.raw.view": true,
  "message.list": true,
  "message.view": true,
  "knowledge.document.download": true,
};

export const ACCESS_ACTION_OPTIONS = Object.keys(ACTION_KEYS) as AccessAction[];

function isAccessAction(value: string): value is AccessAction {
  return Object.prototype.hasOwnProperty.call(ACTION_KEYS, value);
}

export type AccessFilters = {
  clientId: string;
  actor: string;
  action: AccessAction | null;
  from: Date | null;
  to: Date | null;
  fromText: string;
  toText: string;
  page: number;
};

function dateFromInput(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Reads filters from the query string. Dates are whole days (UTC boundaries); unknown actions are ignored. */
export function parseAccessFilters(params: Record<string, string | string[] | undefined>): AccessFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const fromText = one("from");
  const toText = one("to");
  const action = one("action");
  const page = Number.parseInt(one("page"), 10);
  return {
    clientId: one("client").trim().slice(0, 64),
    actor: one("actor").trim().slice(0, 120),
    action: isAccessAction(action) ? action : null,
    from: dateFromInput(fromText, false),
    to: dateFromInput(toText, true),
    fromText: dateFromInput(fromText, false) ? fromText : "",
    toText: dateFromInput(toText, true) ? toText : "",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 100_000) : 1,
  };
}

export function accessQuery(filters: AccessFilters, overrides: { page?: number; omit?: Array<"client"> } = {}): string {
  const query = new URLSearchParams();
  if (filters.clientId && !overrides.omit?.includes("client")) query.set("client", filters.clientId);
  if (filters.actor) query.set("actor", filters.actor);
  if (filters.action) query.set("action", filters.action);
  if (filters.fromText) query.set("from", filters.fromText);
  if (filters.toText) query.set("to", filters.toText);
  const page = overrides.page ?? filters.page;
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** Spreadsheet formulas in exported text (a hostile user agent, say) are neutralised with a leading quote. */
function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const ACCESS_CSV_HEADER = ["at", "client_id", "client", "actor_id", "actor", "actor_role", "action", "entity_type", "entity_id", "count", "ip", "user_agent", "impersonating"] as const;

/** Ids, names of staff/admin accounts, and request metadata only; never call or message content. */
export function accessCsv(rows: AccessLogRow[]): string {
  const lines = [ACCESS_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.at.toISOString(),
        row.clientId,
        row.clientName,
        row.actorUserId,
        row.actorLabel,
        row.actorRole,
        row.action,
        row.entityType,
        row.entityId,
        row.count,
        row.ip,
        row.userAgent,
        row.impersonating,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
