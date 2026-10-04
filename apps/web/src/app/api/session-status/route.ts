import { peekSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Tiny signed-in check for the marketing header island. Never used for authorization. */
export async function GET(): Promise<Response> {
  const session = await peekSession();
  return Response.json({ signedIn: Boolean(session) }, { headers: { "Cache-Control": "private, no-store" } });
}
