import { getEnv } from "@alinstra/config";
import { inboundVariables } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

const UNKNOWN = { call_inbound: { dynamic_variables: { office_open: "unknown", allowed_numbers: "" } } };

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const body = JSON.parse(raw) as { call_inbound?: { to_number?: string } };
    const toNumber = body.call_inbound?.to_number ?? "";
    if (!toNumber) return Response.json(UNKNOWN);
    const variables = await inboundVariables(toNumber);
    return Response.json({ call_inbound: { dynamic_variables: variables } });
  } catch {
    return Response.json(UNKNOWN);
  }
}
