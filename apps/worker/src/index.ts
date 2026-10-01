import { getEnv, log, scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config";
import { decryptString } from "@alinstra/crypto";
import { prisma } from "@alinstra/db";
import { sendEmail } from "@alinstra/email";
import {
  bullConnection,
  EMAIL_QUEUE,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "@alinstra/queue";
import * as Sentry from "@sentry/node";
import { Worker } from "bullmq";

const env = getEnv();

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event as SentryLikeEvent) as typeof event;
  },
});

async function sendInvite(inviteId: string): Promise<void> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.acceptedAt || invite.revokedAt || !invite.tokenCipher) return;
  const token = decryptString(invite.tokenCipher, env.ENCRYPTION_KEY);
  const url = `${env.APP_URL}/invite/${token}`;
  await sendEmail({
    to: invite.email,
    subject: "You're invited to Alinstra",
    text: `Accept your invite: ${url}\nThis link expires and can be used once.`,
  });
  await prisma.invite.update({
    where: { id: invite.id },
    data: { emailSentAt: new Date(), tokenCipher: null },
  });
}

async function sendPasswordReset(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your Alinstra password",
    text: `Set a new password: ${url}\nIf you did not ask for this, you can ignore the message.`,
  });
}

const worker = new Worker(
  EMAIL_QUEUE,
  async (job) => {
    if (job.name === "send-invite-email") {
      const payload = sendInviteEmail.parse(job.data);
      await sendInvite(payload.inviteId);
      return;
    }
    if (job.name === "send-password-reset-email") {
      const payload = sendPasswordResetEmail.parse(job.data);
      await sendPasswordReset(payload.to, payload.url);
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
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
