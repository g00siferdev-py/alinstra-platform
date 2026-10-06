import { readRetellRawBody, retellBadSignatureResponse } from "@alinstra/auth/rate-limit";
import { getEnv } from "@alinstra/config";
import { inboundCallPayload } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

const UNKNOWN = { call_inbound: { dynamic_variables: { office_open: "unknown", allowed_targets: "" } } };

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
    const body = JSON.parse(raw) as { call_inbound?: { to_number?: string } };
    const toNumber = body.call_inbound?.to_number ?? "";
    if (!toNumber) return Response.json(UNKNOWN);
    const payload = await inboundCallPayload(toNumber);
    return Response.json({ call_inbound: payload });
  } catch {
    return Response.json(UNKNOWN);
  }
}
