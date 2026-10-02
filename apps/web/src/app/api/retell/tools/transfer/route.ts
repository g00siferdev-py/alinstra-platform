import { getEnv } from "@alinstra/config";
import { clientIdForRetellAgent, decideTransfer } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = JSON.parse(raw) as { call?: { agent_id?: string }; args?: { number?: string } };
  const clientId = body.call?.agent_id ? await clientIdForRetellAgent(body.call.agent_id) : null;
  if (!clientId) return Response.json({ result: "I can't transfer this call. I'll take a message instead." });
  const result = await decideTransfer(clientId, body.args?.number ?? "");
  return Response.json({ result });
}
