import { pausePastDueClients } from "@alinstra/db";
import { enqueueAccountEmail, enqueueSendAdminNotice } from "@alinstra/queue";

export async function runPausePastDue(): Promise<void> {
  const report = await pausePastDueClients();
  for (const notice of report.adminNotices) {
    await enqueueSendAdminNotice(notice);
  }
  for (const mail of report.ownerEmails) {
    await enqueueAccountEmail(mail);
  }
}
