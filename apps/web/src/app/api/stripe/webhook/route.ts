import { getEnv, log } from "@alinstra/config";
import { applyStripeEvent } from "@alinstra/db";
import { verifyStripe } from "@alinstra/providers";
import { enqueueSendAdminNotice } from "@alinstra/queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const raw = await request.text();
  if (!verifyStripe(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await applyStripeEvent(JSON.parse(raw) as Parameters<typeof applyStripeEvent>[0]);
  if (result.notify) {
    await enqueueSendAdminNotice(result.notify).catch((error: unknown) => {
      log("error", "billing notice was not queued", { error: error instanceof Error ? error.name : "unknown" });
    });
  }
  return Response.json({ received: true });
}
