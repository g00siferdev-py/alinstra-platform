import { describe, expect, it } from "vitest";
import { adminReportCsv } from "./admin-report-csv";

describe("adminReportCsv", () => {
  it("exports formula-safe cells", () => {
    const csv = adminReportCsv([
      {
        clientId: "c1",
        clientName: "=Evil",
        internal: false,
        planName: "Starter",
        monthlyPriceCents: 19900,
        minutesUsed: 10,
        includedMinutes: 300,
        overageMinutes: 0,
        overageCents: 0,
        retellCostCents: 50,
        revenueCents: 19900,
        grossMarginCents: 19850,
        grossMarginPercent: 99.7,
        calls: 3,
        messages: 1,
        flaggedCalls: 0,
        billingStatus: "paid",
      },
    ]);
    const [, line] = csv.trim().split("\r\n");
    expect(line).toContain("'=Evil");
    expect(line).toContain("19900");
  });
});
