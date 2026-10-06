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
  messageId: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  /** ISO timestamp of when the message was taken; rendered in the client's timezone. */
  receivedAt: z.string().datetime().optional(),
  timezone: z.string().min(1).optional(),
});

/** Owner "new sign-in" notice. Only already-masked network text travels through Redis; never the raw IP. */
export const sendSignInNotice = z.object({
  to: z.string().email(),
  /** ISO timestamp of the sign-in. */
  at: z.string().datetime(),
  browser: z.string().min(1).max(100),
  maskedNetwork: z.string().min(1).max(60),
  timezone: z.string().min(1).optional(),
});
export type SendSignInNotice = z.infer<typeof sendSignInNotice>;

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
export const BACKUP_DB_JOB_ID = "backup-db-daily";
export const BACKUP_DB_CRON = "30 3 * * *";
export const BACKUP_DB_TIMEZONE = "America/New_York";
export const RECONCILE_CALLS_JOB_ID = "reconcile-calls";
/** Every 15 minutes. */
export const RECONCILE_CALLS_EVERY_MS = 15 * 60 * 1000;
export const REPORT_USAGE_JOB_ID = "report-usage";
/** Every 5 minutes: send Stripe meter events for unreported UsageRecords. */
export const REPORT_USAGE_EVERY_MS = 5 * 60 * 1000;
export const PAUSE_PAST_DUE_JOB_ID = "pause-past-due-daily";
/** 09:00 America/New_York daily: pause clients past due more than 7 days. */
export const PAUSE_PAST_DUE_CRON = "0 9 * * *";
export const PAUSE_PAST_DUE_TIMEZONE = "America/New_York";
/**
 * Monthly owner report emails: 1st of each month at 09:00 America/New_York (single ET run, not per-client local time).
 * Job sends the previous calendar month in each client's timezone.
 */
export const MONTHLY_REPORTS_JOB_ID = "monthly-reports";
export const MONTHLY_REPORTS_CRON = "0 9 1 * *";
export const MONTHLY_REPORTS_TIMEZONE = "America/New_York";

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

/** Sensitive email jobs: drop completed payloads immediately; keep failures for a day for debugging. */
const SENSITIVE_EMAIL_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: true as const,
  removeOnFail: { age: 86_400 },
};

export async function enqueueSendInvite(data: SendInviteEmail): Promise<void> {
  const payload = sendInviteEmail.parse(data);
  await emailJobs().add("send-invite-email", payload, SENSITIVE_EMAIL_JOB_OPTS);
}

export async function enqueueSendPasswordReset(data: SendPasswordResetEmail): Promise<void> {
  const payload = sendPasswordResetEmail.parse(data);
  await emailJobs().add("send-password-reset-email", payload, SENSITIVE_EMAIL_JOB_OPTS);
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

/** Every 15 minutes: resolve CallRecords stuck without endedAt via Retell get-call. */
export async function scheduleReconcileCalls(): Promise<void> {
  await callsJobs().upsertJobScheduler(
    RECONCILE_CALLS_JOB_ID,
    { every: RECONCILE_CALLS_EVERY_MS },
    { name: "reconcile-calls", data: {}, opts: { removeOnComplete: 30, removeOnFail: 30 } },
  );
}

/**
 * Every 5 minutes: report UsageRecord billable minutes to the Stripe alinstra_minutes meter.
 * Fixed jobId so restarts never double-schedule. Exponential backoff on the job itself for transient Stripe errors.
 */
export async function scheduleReportUsage(): Promise<void> {
  await callsJobs().upsertJobScheduler(
    REPORT_USAGE_JOB_ID,
    { every: REPORT_USAGE_EVERY_MS },
    {
      name: "report-usage",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    },
  );
}

/** Daily pause of past-due clients at 09:00 America/New_York. Fixed jobId so restarts never double-schedule. */
export async function schedulePausePastDue(): Promise<void> {
  await callsJobs().upsertJobScheduler(
    PAUSE_PAST_DUE_JOB_ID,
    { pattern: PAUSE_PAST_DUE_CRON, tz: PAUSE_PAST_DUE_TIMEZONE },
    { name: "pause-past-due", data: {}, opts: { removeOnComplete: 30, removeOnFail: 30 } },
  );
}

/**
 * Owner monthly report emails on the 1st at 09:00 America/New_York (single ET run).
 * Fixed jobId so restarts never double-schedule.
 */
export async function scheduleMonthlyReports(): Promise<void> {
  await callsJobs().upsertJobScheduler(
    MONTHLY_REPORTS_JOB_ID,
    { pattern: MONTHLY_REPORTS_CRON, tz: MONTHLY_REPORTS_TIMEZONE },
    { name: "monthly-reports", data: {}, opts: { removeOnComplete: 30, removeOnFail: 30 } },
  );
}

/**
 * Nightly encrypted database backup at 03:30 America/New_York. Fixed jobId so restarts never double-schedule;
 * one attempt only, because the job reports its own failure and a retry would just repeat a multi-minute dump.
 */
export async function scheduleBackupDb(): Promise<void> {
  await callsJobs().upsertJobScheduler(
    BACKUP_DB_JOB_ID,
    { pattern: BACKUP_DB_CRON, tz: BACKUP_DB_TIMEZONE },
    { name: "backup-db", data: {}, opts: { attempts: 1, removeOnComplete: 30, removeOnFail: 30 } },
  );
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

export async function enqueueSignInNotice(data: SendSignInNotice): Promise<void> {
  const payload = sendSignInNotice.parse(data);
  await emailJobs().add("send-signin-notice", payload, SENSITIVE_EMAIL_JOB_OPTS);
}

export async function enqueueMessageEmail(data: SendMessageEmail): Promise<void> {
  const payload = sendMessageEmail.parse(data);
  await emailJobs().add("send-message-email", payload, SENSITIVE_EMAIL_JOB_OPTS);
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
