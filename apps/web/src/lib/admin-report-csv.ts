/** Pure helpers for admin business-report CSV. Formula-safe like the access log export. */

import type { AdminReportRow } from "@alinstra/db";

function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const ADMIN_REPORT_CSV_HEADER = [
  "client_id",
  "client",
  "internal",
  "plan",
  "monthly_price_cents",
  "minutes_used",
  "minutes_included",
  "overage_minutes",
  "overage_cents",
  "retell_cost_cents",
  "revenue_cents",
  "gross_margin_cents",
  "gross_margin_percent",
  "calls",
  "messages",
  "flagged_calls",
  "billing_status",
] as const;

export function adminReportCsv(rows: AdminReportRow[]): string {
  const lines = [ADMIN_REPORT_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.clientId,
        row.clientName,
        row.internal,
        row.planName,
        row.monthlyPriceCents,
        row.minutesUsed,
        row.includedMinutes,
        row.overageMinutes,
        row.overageCents,
        row.retellCostCents,
        row.revenueCents,
        row.grossMarginCents,
        row.grossMarginPercent,
        row.calls,
        row.messages,
        row.flaggedCalls,
        row.billingStatus,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
