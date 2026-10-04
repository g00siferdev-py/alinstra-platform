import { getEnv, log } from "@alinstra/config";
import { applyRetellCall } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";
import { enqueueStoreRecording } from "@alinstra/queue";

export const dynamic = "force-dynamic";

/**
 * Retell call lifecycle webhook. Events consumed: `call_started`, `call_ended`, `call_analyzed`
 * (https://docs.retellai.com/features/webhook). Retell retries without a 2xx, and events can repeat or
 * arrive out of order; `applyRetellCall` is idempotent by `call_id`. The recording copy is queued
 * exactly once, when the row first learns a recording exists; only the call id goes to Redis.
 */
export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(raw) as Parameters<typeof applyRetellCall>[0];
  const result = await applyRetellCall(payload);
  if (result.recordingQueued && payload.call?.call_id) {
    try {
      await enqueueStoreRecording({ retellCallId: payload.call.call_id });
    } catch (error) {
      log("error", "recording job was not queued", { error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return new Response(null, { status: 204 });
}
