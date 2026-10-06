import { getEnv, log } from "@alinstra/config";
import { reportUsageToStripe } from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { enqueueSendAdminNotice } from "@alinstra/queue";

export type ReportUsageJobDeps = {
  report?: typeof reportUsageToStripe;
};

/**
 * Worker entry for the report-usage scheduler. Sends Stripe meter events for paid
 * non-internal UsageRecords; after 24h of per-row failures, emails admin.
 */
export async function runReportUsage(deps: ReportUsageJobDeps = {}): Promise<void> {
  const { billing } = platformsFor(getEnv());
  const report = await (deps.report ?? reportUsageToStripe)({
    billing,
    notifyAdmin: async (subject, text) => {
      await enqueueSendAdminNotice({ subject, text });
    },
  });
  log("info", "usage meter report finished", {
    scanned: report.scanned,
    reported: report.reported,
    corrected: report.corrected,
    failed: report.failed,
    notified: report.notified,
    skipped: report.skipped,
  });
}
