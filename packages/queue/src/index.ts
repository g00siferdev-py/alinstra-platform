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

export const syncAgent = z.object({
  clientId: z.string().min(1),
});

export const provisionClient = z.object({
  clientId: z.string().min(1),
});

export const sendAccountEmail = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
});

export const sendMessageEmail = z.object({
  clientId: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  callerName: z.string().min(1),
  body: z.string().min(1),
  /** ISO timestamp of when the message was taken; rendered in the client's timezone. */
  receivedAt: z.string().datetime().optional(),
  timezone: z.string().min(1).optional(),
});

export type SyncAgent = z.infer<typeof syncAgent>;
export type ProvisionClient = z.infer<typeof provisionClient>;
export type SendAccountEmail = z.infer<typeof sendAccountEmail>;
export type SendMessageEmail = z.infer<typeof sendMessageEmail>;

/** Only the provider's call id travels through Redis; the worker resolves the recording itself. */
export const storeRecording = z.object({
  retellCallId: z.string().min(1).max(120),
});
export type StoreRecording = z.infer<typeof storeRecording>;

export const EMAIL_QUEUE = "email";
export const KNOWLEDGE_QUEUE = "knowledge";
export const PROVISION_QUEUE = "provision";
export const CALLS_QUEUE = "calls";
export const PURGE_CALLS_JOB_ID = "purge-calls-daily";
export const PURGE_CALLS_CRON = "15 3 * * *";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      family: 0,
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
    family: 0,
  };
}

let emailQueue: Queue | undefined;
let knowledgeQueue: Queue | undefined;
let provisionQueue: Queue | undefined;
let callsQueue: Queue | undefined;

export function callsJobs(): Queue {
  if (!callsQueue) {
    callsQueue = new Queue(CALLS_QUEUE, { connection: bullConnection() });
  }
  return callsQueue;
}

function emailJobs(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE, { connection: bullConnection() });
  }
  return emailQueue;
}

function provisionJobs(): Queue {
  if (!provisionQueue) {
    provisionQueue = new Queue(PROVISION_QUEUE, { connection: bullConnection() });
  }
  return provisionQueue;
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

function alreadyQueued(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

export async function enqueueSyncAgent(data: SyncAgent): Promise<void> {
  const payload = syncAgent.parse(data);
  try {
    await provisionJobs().add("sync-agent", payload, {
      jobId: `sync-${payload.clientId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (error) {
    if (!alreadyQueued(error)) throw error;
  }
}

export async function enqueueProvisionClient(data: ProvisionClient): Promise<void> {
  const payload = provisionClient.parse(data);
  try {
    await provisionJobs().add("provision-client", payload, {
      jobId: `provision-${payload.clientId}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (error) {
    if (!alreadyQueued(error)) throw error;
  }
}

/** One copy job per call: the jobId dedupes retries from Retell's webhook. Three attempts with backoff. */
export async function enqueueStoreRecording(data: StoreRecording): Promise<void> {
  const payload = storeRecording.parse(data);
  try {
    await callsJobs().add("store-recording", payload, {
      jobId: `recording-${payload.retellCallId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 200,
    });
  } catch (error) {
    if (!alreadyQueued(error)) throw error;
  }
}

/** Daily retention purge, fixed jobId so restarts never double-schedule. */
export async function schedulePurgeCalls(): Promise<void> {
  await callsJobs().upsertJobScheduler(PURGE_CALLS_JOB_ID, { pattern: PURGE_CALLS_CRON }, {
    name: "purge-calls",
    data: {},
    opts: { removeOnComplete: 30, removeOnFail: 30 },
  });
}

export async function enqueueAccountEmail(data: SendAccountEmail): Promise<void> {
  const payload = sendAccountEmail.parse(data);
  await emailJobs().add("send-account-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueMessageEmail(data: SendMessageEmail): Promise<void> {
  const payload = sendMessageEmail.parse(data);
  await emailJobs().add("send-message-email", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function closeQueue(): Promise<void> {
  await emailQueue?.close();
  await knowledgeQueue?.close();
  await provisionQueue?.close();
  await callsQueue?.close();
  callsQueue = undefined;
  provisionQueue = undefined;
  emailQueue = undefined;
  knowledgeQueue = undefined;
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
}
