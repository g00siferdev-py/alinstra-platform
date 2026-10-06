import { BusiestTimesChart } from "@/components/busiest-times-chart";
import { MonthPicker } from "@/components/month-picker";
import { Card, PageHeader, ProgressBar, SectionCard } from "@/components/ui";
import {
  clients,
  formatYearMonth,
  lastFullYearMonth,
  monthLabelOf,
  monthPickerOptions,
  ownerMonthlyReport,
  parseYearMonth,
} from "@alinstra/db";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import Link from "next/link";
import { notFound } from "next/navigation";

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes === 0) return `${rem}s`;
  return `${minutes}m ${String(rem).padStart(2, "0")}s`;
}

function MetricCard({
  label,
  value,
  hint,
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  title?: string;
}) {
  return (
    <Card className="grid gap-1">
      <p className="text-[13px] font-semibold text-[var(--muted)]" title={title}>
        {label}
      </p>
      <p className="text-[28px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">{value}</p>
      {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
    </Card>
  );
}

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();

  const client = await clients({
    role: "client_owner",
    clientId: session.user.clientId,
  }).getById(session.user.clientId);
  if (!client) notFound();

  const params = await searchParams;
  const rawMonth = typeof params.month === "string" ? params.month : undefined;
  const defaultMonth = lastFullYearMonth(client.timezone);
  const selected = parseYearMonth(rawMonth) ?? defaultMonth;
  const report = await ownerMonthlyReport(
    { role: "client_owner", clientId: session.user.clientId },
    session.user.clientId,
    selected,
  );

  const options = monthPickerOptions(defaultMonth).map((ym) => ({
    value: formatYearMonth(ym),
    label: monthLabelOf(ym),
  }));

  return (
    <main className="grid gap-6">
      <PageHeader
        title="Reports"
        description={`Calendar month in ${report.timezone}. Minutes here are calendar-month totals; Billing shows the Stripe billing period.`}
        actions={<MonthPicker selected={formatYearMonth(report.yearMonth)} options={options} basePath="/home/reports" />}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Calls answered" value={String(report.callsAnswered)} />
        <MetricCard label="After-hours calls" value={String(report.afterHoursCalls)} hint="Office closed at call start" />
        <MetricCard label="Messages taken" value={String(report.messagesTaken)} />
        <MetricCard
          label="Appointment requests"
          value={String(report.appointmentRequests)}
          title={report.appointmentRequestsNote}
          hint="Booked outcomes only"
        />
        <MetricCard label="Transfers" value={String(report.transfers)} />
        <Card className="grid gap-2 sm:col-span-2">
          <p className="text-[13px] font-semibold text-[var(--muted)]">Minutes used vs plan (calendar month)</p>
          <p className="text-[28px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">
            {report.minutesUsed}
            <span className="text-base font-bold text-[var(--muted)]"> / {report.includedMinutes} min</span>
          </p>
          <ProgressBar value={report.minutesUsed} max={report.includedMinutes || 1} />
          <p className="text-xs text-[var(--muted)]">
            Calendar month, not billing period. See <Link className="underline" href="/home/billing">Billing</Link> for
            the period Stripe bills.
          </p>
        </Card>
        <MetricCard label="Average call length" value={formatSeconds(report.averageCallLengthSeconds)} />
        <MetricCard label="Flagged calls" value={String(report.flaggedCalls)} />
      </section>

      <SectionCard title="Busiest times">
        <div className="px-5 py-4">
          {report.busiestTimes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No calls in this month yet.</p>
          ) : (
            <BusiestTimesChart cells={report.busiestTimes} />
          )}
        </div>
      </SectionCard>
    </main>
  );
}
