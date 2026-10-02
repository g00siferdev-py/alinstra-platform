import { getEnv } from "@alinstra/config";
import { inboundVariables } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = JSON.parse(raw) as { call?: { to_number?: string } };
  const variables = await inboundVariables(body.call?.to_number ?? "");
  return Response.json({ dynamic_variables: variables });
}
