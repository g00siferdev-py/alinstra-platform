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

export type SendInviteEmail = z.infer<typeof sendInviteEmail>;
export type SendPasswordResetEmail = z.infer<typeof sendPasswordResetEmail>;
export type ExtractKnowledgeText = z.infer<typeof extractKnowledgeText>;

export const EMAIL_QUEUE = "email";

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

function queue(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE, { connection: bullConnection() });
  }
  return emailQueue;
}

export async function enqueueSendInvite(data: SendInviteEmail): Promise<void> {
  const payload = sendInviteEmail.parse(data);
  await queue().add("send-invite-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueSendPasswordReset(data: SendPasswordResetEmail): Promise<void> {
  const payload = sendPasswordResetEmail.parse(data);
  await queue().add("send-password-reset-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueExtractKnowledge(data: ExtractKnowledgeText): Promise<void> {
  const payload = extractKnowledgeText.parse(data);
  await queue().add("extract-knowledge-text", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function closeQueue(): Promise<void> {
  await emailQueue?.close();
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
}
