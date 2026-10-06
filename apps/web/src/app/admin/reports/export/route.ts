import { adminReportCsv } from "@/lib/admin-report-csv";
import { getSession } from "@/lib/session";
import { adminBusinessReport, formatYearMonth, lastFullYearMonth, parseYearMonth } from "@alinstra/db";

export const dynamic = "force-dynamic";

/** CSV of the admin business report. Admin with two-factor only; anything else is a plain 404. */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") return new Response("Not found", { status: 404 });
  if (!session.user.twoFactorEnabled) return new Response("Unauthorized", { status: 401 });

  const monthParam = new URL(request.url).searchParams.get("month");
  const selected = parseYearMonth(monthParam) ?? lastFullYearMonth("America/New_York");
  const report = await adminBusinessReport({ role: "admin" }, selected);
  const rows = [...report.clients, ...report.internal];
  const stamp = formatYearMonth(selected);
  return new Response(adminReportCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alinstra-business-report-${stamp}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
