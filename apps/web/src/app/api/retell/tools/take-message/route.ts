import { getEnv } from "@alinstra/config";
import { clientIdForRetellAgent, recordTakenMessage } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";
import { enqueueMessageEmail } from "@alinstra/queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = JSON.parse(raw) as { call?: { agent_id?: string }; args?: { caller_name?: string; callback_number?: string; message?: string } };
  const clientId = body.call?.agent_id ? await clientIdForRetellAgent(body.call.agent_id) : null;
  if (!clientId) return Response.json({ result: "I could not save that message. Please try again." }, { status: 200 });
  const saved = await recordTakenMessage(clientId, {
    callerName: body.args?.caller_name,
    callbackNumber: body.args?.callback_number,
    message: body.args?.message,
  }, env.ADMIN_EMAIL);
  if (saved.recipients.length > 0) {
    await enqueueMessageEmail({
      clientId,
      recipients: saved.recipients,
      callerName: body.args?.caller_name?.trim() || "Caller",
      body: body.args?.message?.trim() || "Message",
    });
  }
  return Response.json({ result: saved.sentence });
}
