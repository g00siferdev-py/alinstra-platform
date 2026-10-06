import { readRetellRawBody, retellBadSignatureResponse } from "@alinstra/auth/rate-limit";
import { getEnv, log } from "@alinstra/config";
import { clientIdForRetellAgent, plainCallerName, recordTakenMessage } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";
import { enqueueMessageEmail } from "@alinstra/queue";

export const dynamic = "force-dynamic";

export function missingMessageSentence(args: { callback_number?: string; message?: string }): string | null {
  const needsNumber = !(args.callback_number ?? "").trim();
  const needsMessage = !(args.message ?? "").trim();
  if (needsNumber && needsMessage) return "I still need the caller's callback number and message.";
  if (needsNumber) return "I still need the caller's callback number.";
  if (needsMessage) return "I still need the message.";
  return null;
}

/** Order: body size cap → signature → only bad signatures are rate-limited → JSON/DB. */
export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const rawOrError = await readRetellRawBody(request);
  if (rawOrError instanceof Response) return rawOrError;
  const raw = rawOrError;
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return retellBadSignatureResponse(request);
  }
  try {
    const body = JSON.parse(raw) as { call?: { agent_id?: string; call_id?: string }; args?: { caller_name?: string; callback_number?: string; message?: string } };
    const missing = missingMessageSentence(body.args ?? {});
    if (missing) return Response.json({ result: missing });
    const clientId = body.call?.agent_id ? await clientIdForRetellAgent(body.call.agent_id) : null;
    if (!clientId) return Response.json({ result: "I could not save that message. Please try again." });
    const callerName = plainCallerName(body.args?.caller_name ?? "");
    const saved = await recordTakenMessage(clientId, {
      callerName,
      callbackNumber: body.args?.callback_number,
      message: body.args?.message,
    }, env.ADMIN_EMAIL, typeof body.call?.call_id === "string" ? body.call.call_id : null);
    if (saved.recipients.length > 0) {
      try {
        await enqueueMessageEmail({
          messageId: saved.messageId,
          recipients: saved.recipients,
          receivedAt: saved.receivedAt.toISOString(),
          timezone: saved.timezone,
        });
      } catch (error) {
        log("error", "message email was not queued", { error: error instanceof Error ? error.name : "unknown" });
      }
    }
    return Response.json({ result: saved.sentence });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/message is required|callback/i.test(text)) {
      return Response.json({ result: "I still need the caller's callback number and message." });
    }
    log("error", "take message failed", { error: error instanceof Error ? error.name : "unknown" });
    return Response.json({ result: "I could not save that message. Please try again." });
  }
}
