/**
 * Phase B Part 5: short owner monthly report (counts only — no caller names, numbers, or message text).
 */

export function monthlyReportOwnerEmail(input: {
  monthLabel: string;
  callsAnswered: number;
  messagesTaken: number;
  minutesUsed: number;
  includedMinutes: number;
  reportUrl: string;
}): { subject: string; text: string } {
  return {
    subject: `Your Alinstra report for ${input.monthLabel}`,
    text: [
      `Here's a quick look at ${input.monthLabel}:`,
      "",
      `Calls answered: ${input.callsAnswered}`,
      `Messages taken: ${input.messagesTaken}`,
      `Minutes used: ${input.minutesUsed} of ${input.includedMinutes} (calendar month)`,
      "",
      `Full report: ${input.reportUrl}`,
      "",
      "You can turn this email off under My Business → Monthly report email.",
    ].join("\n"),
  };
}
