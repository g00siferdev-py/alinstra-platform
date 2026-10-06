import { getEnv, log, scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config";
import { activeKeyId, configuredKeyIds } from "@alinstra/crypto";
import { sendEmail } from "@alinstra/email";
import { EXTRACT_TIMEOUT_MS, setDecryptFailureReporter } from "@alinstra/db";
import {
  bullConnection,
  CALLS_QUEUE,
  EMAIL_QUEUE,
  extractKnowledgeText,
  KNOWLEDGE_QUEUE,
  PROVISION_QUEUE,
  provisionClient,
  scheduleBackupDb,
  schedulePurgeCalls,
  scheduleReconcileCalls,
  scheduleReportUsage,
  schedulePausePastDue,
  sendAccountEmail,
  sendAdminNotice,
  sendInviteEmail,
  sendMessageEmail,
  sendPasswordResetEmail,
  sendSignInNotice as sendSignInNoticePayload,
  storeRecording,
  syncAgent,
} from "@alinstra/queue";
import * as Sentry from "@sentry/node";
import { UnrecoverableError, Worker } from "bullmq";
import { runBackupDb } from "./jobs/backup";
import { runPurgeCalls, runReconcileCalls, runStoreRecording } from "./jobs/calls";
import { markExtractionFailed } from "./jobs/extract-knowledge-text";
import { runIsolatedJob } from "./jobs/run-isolated";
import { runChurnSweep, runMessageEmail, runProvision, runSync } from "./jobs/phase3";
import { runReportUsage } from "./jobs/report-usage";
import { runPausePastDue } from "./jobs/pause-past-due";
import { deliverAdminNotice } from "./jobs/send-admin-notice";
import { sendInvite } from "./jobs/send-invite-email";
import { sendPasswordReset } from "./jobs/send-password-reset-email";
import { sendSignInNotice } from "./jobs/send-signin-notice";

const env = getEnv();

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event as SentryLikeEvent) as typeof event;
  },
});

setDecryptFailureReporter((fields) => {
  Sentry.captureMessage("cipher.decrypt_failed", { level: "error", tags: { area: "cipher" }, extra: fields });
});

log("info", "encryption.keyring", { keys: configuredKeyIds().join(","), active: activeKeyId() });

const connection = bullConnection();

const email = new Worker(
  EMAIL_QUEUE,
  async (job) => {
    if (job.name === "send-invite-email") {
      await sendInvite(sendInviteEmail.parse(job.data).inviteId);
      return;
    }
    if (job.name === "send-password-reset-email") {
      const payload = sendPasswordResetEmail.parse(job.data);
      await sendPasswordReset(payload.to, payload.url);
      return;
    }
    if (job.name === "send-admin-notice") {
      const payload = sendAdminNotice.parse(job.data);
      await deliverAdminNotice(payload.subject, payload.text);
      return;
    }
    if (job.name === "send-account-email") {
      const payload = sendAccountEmail.parse(job.data);
      await sendEmail({ to: payload.to, subject: payload.subject, text: payload.text });
      return;
    }
    if (job.name === "send-signin-notice") {
      await sendSignInNotice(sendSignInNoticePayload.parse(job.data));
      return;
    }
    if (job.name === "send-message-email") {
      await runMessageEmail(sendMessageEmail.parse(job.data));
      return;
    }
    log("warn", "unknown job", { job: job.name });
  },
  { connection, concurrency: 5 },
);

const knowledge = new Worker(
  KNOWLEDGE_QUEUE,
  async (job) => {
    const { documentId } = extractKnowledgeText.parse(job.data);
    try {
      await runIsolatedJob(
        new URL("./jobs/extract-knowledge-thread.ts", import.meta.url),
        { documentId },
        EXTRACT_TIMEOUT_MS,
        { transpile: true },
      );
    } catch (error) {
      await markExtractionFailed(documentId, "Extraction timed out.");
      log("error", "knowledge extraction killed", {
        documentId,
        error: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : "unknown",
      });
      throw new UnrecoverableError("Extraction timed out.");
    }
  },
  { connection, concurrency: 1 },
);

const provision = new Worker(
  PROVISION_QUEUE,
  async (job) => {
    if (job.name === "provision-client") {
      await runProvision(provisionClient.parse(job.data).clientId);
      return;
    }
    if (job.name === "sync-agent") {
      await runSync(syncAgent.parse(job.data).clientId);
      return;
    }
    if (job.name === "churn-sweep") {
      await runChurnSweep();
      return;
    }
    log("warn", "unknown job", { job: job.name });
  },
  { connection, concurrency: 2 },
);

const calls = new Worker(
  CALLS_QUEUE,
  async (job) => {
    if (job.name === "store-recording") {
      await runStoreRecording(storeRecording.parse(job.data).retellCallId);
      return;
    }
    if (job.name === "purge-calls") {
      await runPurgeCalls();
      return;
    }
    if (job.name === "reconcile-calls") {
      await runReconcileCalls();
      return;
    }
    if (job.name === "report-usage") {
      await runReportUsage();
      return;
    }
    if (job.name === "pause-past-due") {
      await runPausePastDue();
      return;
    }
    if (job.name === "backup-db") {
      await runBackupDb();
      return;
    }
    log("warn", "unknown job", { job: job.name });
  },
  { connection, concurrency: 2 },
);

void schedulePurgeCalls().catch((error: unknown) => {
  log("error", "purge schedule failed", { error: error instanceof Error ? error.name : "unknown" });
});

void scheduleReconcileCalls().catch((error: unknown) => {
  log("error", "reconcile schedule failed", { error: error instanceof Error ? error.name : "unknown" });
});

void scheduleReportUsage().catch((error: unknown) => {
  log("error", "report-usage schedule failed", { error: error instanceof Error ? error.name : "unknown" });
});

void schedulePausePastDue().catch((error: unknown) => {
  log("error", "pause-past-due schedule failed", { error: error instanceof Error ? error.name : "unknown" });
});

void scheduleBackupDb().catch((error: unknown) => {
  log("error", "backup schedule failed", { error: error instanceof Error ? error.name : "unknown" });
});

void runChurnSweep().catch((error: unknown) => {
  log("error", "churn sweep failed", { error: error instanceof Error ? error.name : "unknown" });
});
setInterval(() => {
  void runChurnSweep().catch((error: unknown) => {
    log("error", "churn sweep failed", { error: error instanceof Error ? error.name : "unknown" });
  });
}, 60 * 60 * 1000);

for (const worker of [email, knowledge, provision, calls]) {
  worker.on("failed", (job, error) => {
    log("error", "job failed", { job: job?.name ?? "unknown", error: error.name });
    Sentry.captureException(error);
  });
}

log("info", "worker listening", { queues: [EMAIL_QUEUE, KNOWLEDGE_QUEUE, PROVISION_QUEUE, CALLS_QUEUE].join(",") });

async function shutdown(): Promise<void> {
  await Promise.all([email.close(), knowledge.close(), provision.close(), calls.close()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
