import { accessCsv, parseAccessFilters } from "@/lib/access-view";
import { getSession } from "@/lib/session";
import { accessLogs } from "@alinstra/db";

export const dynamic = "force-dynamic";

/** CSV of the filtered access log. Admin with two-factor only, like the page; anything else is a plain 404. */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") return new Response("Not found", { status: 404 });
  if (!session.user.twoFactorEnabled) return new Response("Unauthorized", { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = parseAccessFilters(params);
  const rows = await accessLogs({ role: "admin" }).exportRows({
    clientId: filters.clientId,
    actor: filters.actor,
    action: filters.action,
    from: filters.from,
    to: filters.to,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(accessCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alinstra-access-log-${stamp}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
