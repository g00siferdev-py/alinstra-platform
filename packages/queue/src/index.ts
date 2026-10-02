import { getEnv } from "@alinstra/config";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

export const sendInviteEmail = z.object({
  inviteId: z.string().min(1),
});

export const sendPasswordResetEmail = z.object({
  to: z.string().email(),
  url: z.string().url(),
});

export const extractKnowledgeText = z.object({
  documentId: z.string().min(1),
});

export const sendAdminNotice = z.object({
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
});

export type SendInviteEmail = z.infer<typeof sendInviteEmail>;
export type SendPasswordResetEmail = z.infer<typeof sendPasswordResetEmail>;
export type ExtractKnowledgeText = z.infer<typeof extractKnowledgeText>;
export type SendAdminNotice = z.infer<typeof sendAdminNotice>;

export const EMAIL_QUEUE = "email";
export const KNOWLEDGE_QUEUE = "knowledge";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return redis;
}

export function bullConnection(): ConnectionOptions {
  const url = new URL(getEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

let emailQueue: Queue | undefined;
let knowledgeQueue: Queue | undefined;

function emailJobs(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE, { connection: bullConnection() });
  }
  return emailQueue;
}

function knowledgeJobs(): Queue {
  if (!knowledgeQueue) {
    knowledgeQueue = new Queue(KNOWLEDGE_QUEUE, { connection: bullConnection() });
  }
  return knowledgeQueue;
}

export async function enqueueSendInvite(data: SendInviteEmail): Promise<void> {
  const payload = sendInviteEmail.parse(data);
  await emailJobs().add("send-invite-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueSendPasswordReset(data: SendPasswordResetEmail): Promise<void> {
  const payload = sendPasswordResetEmail.parse(data);
  await emailJobs().add("send-password-reset-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueSendAdminNotice(data: SendAdminNotice): Promise<void> {
  const payload = sendAdminNotice.parse(data);
  await emailJobs().add("send-admin-notice", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueExtractKnowledge(data: ExtractKnowledgeText): Promise<void> {
  const payload = extractKnowledgeText.parse(data);
  await knowledgeJobs().add("extract-knowledge-text", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function closeQueue(): Promise<void> {
  await emailQueue?.close();
  await knowledgeQueue?.close();
  emailQueue = undefined;
  knowledgeQueue = undefined;
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
}
