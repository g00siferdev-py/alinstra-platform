import { sendMonthlyReportEmails } from "@alinstra/db";
import { enqueueAccountEmail } from "@alinstra/queue";

export async function runMonthlyReports(): Promise<void> {
  const report = await sendMonthlyReportEmails();
  for (const mail of report.ownerEmails) {
    await enqueueAccountEmail(mail);
  }
}
