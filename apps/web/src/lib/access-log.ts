import { clientIp, getCounter } from "@alinstra/auth";
import { log } from "@alinstra/config";
import { recordAccess, type AccessAction, type AccessEntry, type AccessFailureIds } from "@alinstra/db";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { checkBulkReads, isBulkReadAction } from "./bulk-read-alert";

/**
 * Read-access audit logging for the web app (Phase S part 2). Every call here is awaited and best-effort:
 * a failed insert is reported to Sentry with ids only and the page is still served. Nothing in this file
 * ever receives a transcript, message body, caller name, or phone number; only ids and counts.
 */

/** One recording row per call per actor per 10 minutes (Range requests included). */
export const RECORDING_LOG_WINDOW_SECONDS = 600;

type ActorUser = { id: string; role: string; clientId?: string | null };

function actorRole(role: string): AccessEntry["actorRole"] | null {
  return role === "admin" || role === "client_owner" || role === "client_staff" ? role : null;
}

async function requestMeta(request?: Request): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const source = request ? request.headers : await headers();
    const view = new Request("http://internal.invalid/", { headers: source });
    return { ip: clientIp(view), userAgent: source.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** Ids only: the database error text can echo values, so only its name and code are reported. */
export function reportAccessFailure(error: unknown, ids: AccessFailureIds): void {
  const name = error instanceof Error ? error.name : "unknown";
  const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : undefined;
  log("error", "access log insert failed", { ...ids, error: name, code });
  Sentry.captureException(new Error(`AccessLog insert failed (${name}${code ? ` ${code}` : ""})`), {
    tags: { area: "access-log" },
    extra: { ...ids },
  });
}

export type AccessInput = {
  action: AccessAction;
  clientId: string;
  entityType: string;
  entityId: string;
  count?: number | null;
};

/** Writes one row. Returns whether it was written; never throws. */
export async function logAccess(user: ActorUser, input: AccessInput, request?: Request, shouldWrite?: () => Promise<boolean>): Promise<boolean> {
  const role = actorRole(user.role);
  if (!role) return false;
  try {
    const meta = await requestMeta(request);
    const written = await recordAccess(
      {
        actorUserId: user.id,
        actorRole: role,
        clientId: input.clientId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        impersonating: false,
        count: input.count ?? null,
      },
      { onError: reportAccessFailure, shouldWrite },
    );
    // Phase S part 3: bulk-read alert, hooked after the row is written. Best-effort; never throws.
    if (written && isBulkReadAction(input.action)) await checkBulkReads({ id: user.id, role }, input.clientId);
    return written;
  } catch (error) {
    reportAccessFailure(error, { actorUserId: user.id, clientId: input.clientId, action: input.action, entityType: input.entityType, entityId: input.entityId });
    return false;
  }
}

/** Call detail page: transcript, admin raw events, and the captured message (caller name) shown beside it. */
export async function logCallDetailView(
  user: ActorUser,
  call: {
    id: string;
    clientId: string;
    purgedAt: Date | null;
    transcript: unknown;
    summary: string | null;
    rawEvents: unknown[] | null;
    message: { id: string } | null;
  },
  request?: Request,
): Promise<void> {
  if (!call.purgedAt && (call.transcript || call.summary)) {
    await logAccess(user, { action: "call.transcript.view", clientId: call.clientId, entityType: "call_record", entityId: call.id }, request);
  }
  if (user.role === "admin" && call.rawEvents && call.rawEvents.length > 0) {
    await logAccess(user, { action: "call.raw.view", clientId: call.clientId, entityType: "call_record", entityId: call.id }, request);
  }
  if (call.message) {
    await logAccess(user, { action: "message.view", clientId: call.clientId, entityType: "client_message", entityId: call.message.id }, request);
  }
}

/** Recording stream: deduped through Redis so a seek-heavy session is one row. If Redis fails, the row is written. */
export async function logRecordingStream(user: ActorUser, call: { id: string; clientId: string }, request: Request): Promise<boolean> {
  const key = `access:recording:${user.id}:${call.id}`;
  return logAccess(
    user,
    { action: "call.recording.stream", clientId: call.clientId, entityType: "call_record", entityId: call.id },
    request,
    async () => (await getCounter().increment(key, RECORDING_LOG_WINDOW_SECONDS)) === 1,
  );
}

/** A list of messages rendered for this actor: one row with the number shown. Empty lists reveal nothing and are skipped. */
export async function logMessageList(user: ActorUser, clientId: string, count: number, request?: Request): Promise<void> {
  if (count <= 0) return;
  await logAccess(user, { action: "message.list", clientId, entityType: "client", entityId: clientId, count }, request);
}

export async function logDocumentDownload(user: ActorUser, document: { id: string; clientId: string }, request?: Request): Promise<void> {
  await logAccess(user, { action: "knowledge.document.download", clientId: document.clientId, entityType: "knowledge_document", entityId: document.id }, request);
}
