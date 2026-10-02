import { getEnv, log, scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config";
import { EXTRACT_TIMEOUT_MS } from "@alinstra/db";
import {
  bullConnection,
  EMAIL_QUEUE,
  extractKnowledgeText,
  KNOWLEDGE_QUEUE,
  sendAdminNotice,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "@alinstra/queue";
import * as Sentry from "@sentry/node";
import { UnrecoverableError, Worker } from "bullmq";
import { markExtractionFailed } from "./jobs/extract-knowledge-text";
import { runIsolatedJob } from "./jobs/run-isolated";
import { deliverAdminNotice } from "./jobs/send-admin-notice";
import { sendInvite } from "./jobs/send-invite-email";
import { sendPasswordReset } from "./jobs/send-password-reset-email";

const env = getEnv();

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event as SentryLikeEvent) as typeof event;
  },
});

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

for (const worker of [email, knowledge]) {
  worker.on("failed", (job, error) => {
    log("error", "job failed", { job: job?.name ?? "unknown", error: error.name });
    Sentry.captureException(error);
  });
}

log("info", "worker listening", { queues: [EMAIL_QUEUE, KNOWLEDGE_QUEUE].join(",") });

async function shutdown(): Promise<void> {
  await Promise.all([email.close(), knowledge.close()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
