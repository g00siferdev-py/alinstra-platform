import { MonthPicker } from "@/components/month-picker";
import { Card, PageHeader, Pill } from "@/components/ui";
import {
  adminBusinessReport,
  formatPlanCents,
  formatYearMonth,
  lastFullYearMonth,
  monthLabelOf,
  monthPickerOptions,
  parseYearMonth,
  type AdminReportRow,
} from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

function statusLabel(status: string): string {
  if (status === "paid") return "Paid";
  if (status === "past_due") return "Past due";
  if (status === "paused") return "Paused";
  if (status === "cancel_scheduled") return "Canceling";
  return status.replaceAll("_", " ");
}

function formatMargin(row: AdminReportRow): string {
  if (row.grossMarginPercent === null) return `${formatPlanCents(row.grossMarginCents)} (—)`;
  return `${formatPlanCents(row.grossMarginCents)} (${row.grossMarginPercent}%)`;
}

function ReportTable({ rows, title }: { rows: AdminReportRow[]; title: string }) {
  if (rows.length === 0) {
    return (
      <Card className="grid gap-2">
        <h2 className="text-base font-extrabold">{title}</h2>
        <p className="text-sm text-[var(--muted)]">No clients in this group.</p>
      </Card>
    );
  }
  return (
    <Card padded={false} className="overflow-x-auto">
      <div className="border-b border-[var(--divider)] px-5 py-4">
        <h2 className="text-base font-extrabold text-[var(--ink)]">{title}</h2>
      </div>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[var(--surface-subtle)] text-[13px] text-[var(--muted)]">
          <tr>
            <th className="px-4 py-2 font-semibold">Client</th>
            <th className="px-4 py-2 font-semibold">Plan</th>
            <th className="px-4 py-2 font-semibold">Price</th>
            <th className="px-4 py-2 font-semibold">Minutes</th>
            <th className="px-4 py-2 font-semibold">Overage</th>
            <th className="px-4 py-2 font-semibold">Retell</th>
            <th className="px-4 py-2 font-semibold">Margin</th>
            <th className="px-4 py-2 font-semibold">Calls</th>
            <th className="px-4 py-2 font-semibold">Msgs</th>
            <th className="px-4 py-2 font-semibold">Flagged</th>
            <th className="px-4 py-2 font-semibold">Billing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--divider)]">
          {rows.map((row) => (
            <tr key={row.clientId}>
              <td className="px-4 py-2 font-semibold text-[var(--ink)]">
                <Link className="underline" href={`/admin/clients/${row.clientId}`}>
                  {row.clientName}
                </Link>
              </td>
              <td className="px-4 py-2">{row.planName ?? "—"}</td>
              <td className="px-4 py-2 tabular-nums">{formatPlanCents(row.monthlyPriceCents)}</td>
              <td className="px-4 py-2 tabular-nums">
                {row.minutesUsed} / {row.includedMinutes}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {row.overageMinutes} ({formatPlanCents(row.overageCents)})
              </td>
              <td className="px-4 py-2 tabular-nums">{formatPlanCents(row.retellCostCents)}</td>
              <td className="px-4 py-2 tabular-nums">{formatMargin(row)}</td>
              <td className="px-4 py-2 tabular-nums">{row.calls}</td>
              <td className="px-4 py-2 tabular-nums">{row.messages}</td>
              <td className="px-4 py-2 tabular-nums">{row.flaggedCalls}</td>
              <td className="px-4 py-2">
                <Pill tone={row.billingStatus === "paid" ? "success" : row.billingStatus === "past_due" || row.billingStatus === "paused" ? "warning" : "neutral"}>
                  {statusLabel(row.billingStatus)}
                </Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const rawMonth = typeof params.month === "string" ? params.month : undefined;
  const defaultMonth = lastFullYearMonth("America/New_York");
  const selected = parseYearMonth(rawMonth) ?? defaultMonth;
  const report = await adminBusinessReport({ role: "admin" }, selected);
  const options = monthPickerOptions(defaultMonth).map((ym) => ({
    value: formatYearMonth(ym),
    label: monthLabelOf(ym),
  }));
  const exportHref = `/admin/reports/export?month=${formatYearMonth(selected)}`;

  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Business report"
        description={`${report.rangeNote} ${report.revenueDisclaimer}`}
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <MonthPicker selected={formatYearMonth(selected)} options={options} basePath="/admin/reports" />
            <a
              className="inline-flex h-11 items-center justify-center rounded-[10px] border border-[var(--secondary-border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--primary-text)]"
              href={exportHref}
            >
              Export CSV
            </a>
          </div>
        }
      />
      <p className="text-sm text-[var(--muted)]">{report.monthLabel} · {report.revenueDisclaimer}</p>
      <ReportTable rows={report.clients} title="Clients" />
      <ReportTable rows={report.internal} title="Internal (not billed)" />
    </main>
  );
}
