import { getEnv } from "@alinstra/config";
import { applyRetellCall } from "@alinstra/db";
import { verifyRetell } from "@alinstra/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyRetell(raw, request.headers.get("x-retell-signature"), env.RETELL_API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  await applyRetellCall(JSON.parse(raw) as Parameters<typeof applyRetellCall>[0]);
  return new Response(null, { status: 204 });
}
