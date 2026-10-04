import { getEnv, log } from "@alinstra/config";
import { clientIdForRetellAgent, decideTransfer, TRANSFER_UNAVAILABLE } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

const UNAVAILABLE = { allowed: false, reason: TRANSFER_UNAVAILABLE };

/**
 * Transfer check. The agent sends the target's label. `number` is still read for agents published before
 * labels, and is matched against saved targets. The response never contains a phone number.
 */
export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const body = JSON.parse(raw) as { call?: { agent_id?: string }; args?: { target?: string; number?: string } };
    const clientId = body.call?.agent_id ? await clientIdForRetellAgent(body.call.agent_id) : null;
    if (!clientId) return Response.json(UNAVAILABLE);
    const decision = await decideTransfer(clientId, { target: body.args?.target, number: body.args?.number });
    return Response.json(decision);
  } catch (error) {
    log("error", "transfer check failed", { error: error instanceof Error ? error.name : "unknown" });
    return Response.json(UNAVAILABLE);
  }
}
