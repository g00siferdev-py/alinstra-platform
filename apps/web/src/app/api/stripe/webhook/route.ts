import { getEnv } from "@alinstra/config";
import { applyStripeEvent } from "@alinstra/db";
import { verifyStripe } from "@alinstra/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyStripe(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  await applyStripeEvent(JSON.parse(raw) as Parameters<typeof applyStripeEvent>[0]);
  return Response.json({ received: true });
}
