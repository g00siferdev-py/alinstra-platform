import { listLiveCalls, type Actor } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireAdmin();
  const actor: Actor = { id: session.user.id, role: "admin" };
  const calls = await listLiveCalls(actor);
  return NextResponse.json({
    calls: calls.map((call) => ({
      ...call,
      startedAt: call.startedAt.toISOString(),
    })),
    count: calls.length,
  });
}
