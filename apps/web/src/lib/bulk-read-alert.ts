import { getCounter } from "@alinstra/auth";
import { getEnv, log } from "@alinstra/config";
import { BULK_READ_ACTIONS, BULK_READ_THRESHOLD, BULK_READ_WINDOW_MS, countRecentBulkReads } from "@alinstra/db";
import { enqueueSendAdminNotice } from "@alinstra/queue";
import * as Sentry from "@sentry/nextjs";

/**
 * Bulk-read alert (Phase S part 3). More than 50 transcript views plus recording streams by one actor in
 * 10 minutes sends an admin notice and a Sentry warning. One alert per actor per hour, deduped through
 * `getCounter()`. Ids and counts only; no call content ever reaches the notice or Sentry.
 */

export const BULK_READ_ALERT_WINDOW_SECONDS = 3600;

type Actor = { id: string; role: string };

export type BulkReadDeps = {
  count: (actorUserId: string) => Promise<number>;
  firstAlertThisHour: (actorUserId: string) => Promise<boolean>;
  adminNotice: (notice: { subject: string; text: string }) => Promise<void>;
  warn: (message: string, extra: Record<string, unknown>) => void;
  appUrl: () => string;
};

export const defaultBulkReadDeps: BulkReadDeps = {
  count: (actorUserId) => countRecentBulkReads(actorUserId),
  firstAlertThisHour: async (actorUserId) => (await getCounter().increment(`alert:bulk-read:${actorUserId}`, BULK_READ_ALERT_WINDOW_SECONDS)) === 1,
  adminNotice: enqueueSendAdminNotice,
  warn: (message, extra) => {
    Sentry.captureMessage(message, { level: "warning", tags: { area: "access-log" }, extra });
  },
  appUrl: () => getEnv().APP_URL.replace(/\/$/, ""),
};

export function isBulkReadAction(action: string): boolean {
  return (BULK_READ_ACTIONS as readonly string[]).includes(action);
}

/**
 * Call after an access row was written. Returns whether an alert was sent. Never throws: a failure here
 * must not break the page being served.
 */
export async function checkBulkReads(actor: Actor, clientId: string, deps: BulkReadDeps = defaultBulkReadDeps): Promise<boolean> {
  try {
    const count = await deps.count(actor.id);
    if (count <= BULK_READ_THRESHOLD) return false;
    if (!(await deps.firstAlertThisHour(actor.id))) return false;

    const windowMinutes = BULK_READ_WINDOW_MS / 60_000;
    const ids = { actorUserId: actor.id, actorRole: actor.role, clientId, count, windowMinutes };
    deps.warn("Bulk call reads by one actor", ids);
    await deps.adminNotice({
      subject: "Unusual number of call reads by one user",
      text: [
        `User ${actor.id} (${actor.role}) opened ${count} call transcripts or recordings in the last ${windowMinutes} minutes (limit ${BULK_READ_THRESHOLD}).`,
        `Most recent client: ${clientId}.`,
        "",
        `Review their activity: ${deps.appUrl()}/admin/access?actor=${encodeURIComponent(actor.id)}`,
      ].join("\n"),
    });
    return true;
  } catch (error) {
    log("error", "bulk read check failed", { error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
