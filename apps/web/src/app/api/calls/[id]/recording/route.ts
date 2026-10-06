import { recordingRateLimitResponse } from "@alinstra/auth/rate-limit";
import { recordingForPlayback } from "@alinstra/db";
import { getStorage } from "@alinstra/storage";
import { logRecordingStream } from "@/lib/access-log";
import { callViewerFor, parseByteRange } from "@/lib/call-viewer";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });

/**
 * Streams a call recording from our bucket after the role check. Supports `Range` so the browser's
 * audio element can seek. There are no public or presigned URLs for recordings; access answers 404,
 * never 403, so callers learn nothing about calls they may not see.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const viewer = callViewerFor(session.user);
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  // 120 requests per 10 minutes per user; Range requests count. Runs before any database or storage work.
  const limited = await recordingRateLimitResponse(session.user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const recording = await recordingForPlayback(viewer, id);
  if (!recording) return NOT_FOUND();
  const storage = getStorage();
  const size = recording.bytes ?? (await storage.byteSize(recording.key));
  if (size === null) return NOT_FOUND();
  const baseHeaders = {
    "content-type": recording.contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
  };
  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${size}` } });
  }
  // Audit trail, written before any audio leaves: one row per call per actor per 10 minutes, so seeking
  // (Range requests) does not flood the log. Refusals and unsatisfiable ranges serve nothing and log nothing.
  await logRecordingStream(session.user, { id: recording.callId, clientId: recording.clientId }, request);
  if (range) {
    const bytes = await storage.getRange(recording.key, range.start, range.end);
    return new Response(new Uint8Array(bytes), {
      status: 206,
      headers: { ...baseHeaders, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(bytes.byteLength) },
    });
  }
  const bytes = await storage.get(recording.key);
  return new Response(new Uint8Array(bytes), { status: 200, headers: { ...baseHeaders, "content-length": String(bytes.byteLength) } });
}
