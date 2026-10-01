import { log } from "@alinstra/config";
import { prisma } from "@alinstra/db";
import { getRedis } from "@alinstra/queue";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let db: "up" | "down" = "down";
  let redis: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    log("error", "health check database failed");
  }

  try {
    const pong = await getRedis().ping();
    redis = pong === "PONG" ? "up" : "down";
  } catch {
    log("error", "health check redis failed");
  }

  const ok = db === "up" && redis === "up";
  return Response.json({ ok, db, redis }, { status: ok ? 200 : 503 });
}
