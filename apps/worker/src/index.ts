import { getEnv, log, scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config";
import { bullConnection, EMAIL_QUEUE, extractKnowledgeText, sendInviteEmail, sendPasswordResetEmail } from "@alinstra/queue";
import * as Sentry from "@sentry/node";
import { Worker } from "bullmq";
import { extractKnowledge } from "./jobs/extract-knowledge-text";
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

const worker = new Worker(
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
    if (job.name === "extract-knowledge-text") {
      await extractKnowledge(extractKnowledgeText.parse(job.data).documentId);
      return;
    }
    log("warn", "unknown job", { job: job.name });
  },
  { connection: bullConnection(), concurrency: 5 },
);

worker.on("failed", (job, error) => {
  log("error", "job failed", { job: job?.name ?? "unknown", error: error.name });
  Sentry.captureException(error);
});

log("info", "worker listening", { queue: EMAIL_QUEUE });

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
