import { describe, expect, it } from "vitest";
import { monthlyReportOwnerEmail } from "./index";

describe("monthlyReportOwnerEmail", () => {
  it("includes headline counts and a report link, without caller content", () => {
    const message = monthlyReportOwnerEmail({
      monthLabel: "September 2026",
      callsAnswered: 12,
      messagesTaken: 4,
      minutesUsed: 40,
      includedMinutes: 300,
      reportUrl: "https://app.example.test/home/reports?month=2026-09",
    });
    expect(message.subject).toContain("September 2026");
    expect(message.text).toContain("Calls answered: 12");
    expect(message.text).toContain("Messages taken: 4");
    expect(message.text).toContain("Minutes used: 40 of 300");
    expect(message.text).toContain("https://app.example.test/home/reports?month=2026-09");
    expect(message.text).not.toMatch(/caller|transcript|\+\d{10}/i);
  });
});
