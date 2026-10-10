import { loadKeyring } from "@alinstra/crypto";
import { z } from "zod";
import { log } from "./log";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(1),
  // Key rotation: kN = ENCRYPTION_KEY_V<N> (N >= 2, read from process.env by @alinstra/crypto).
  // ENCRYPTION_ACTIVE_KEY picks the key for new writes; default "1".
  ENCRYPTION_ACTIVE_KEY: z.string().default(""),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_INITIAL_PASSWORD: z.string().min(12).optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().min(3),
  EMAIL_TRANSPORT: z.enum(["console", "resend"]).default("console"),
  SENTRY_DSN: z.string().default(""),
  SENTRY_ENVIRONMENT: z.string().default("local"),
  LOCKOUT_STORE: z.enum(["redis", "memory"]).optional(),
  // How many rightmost X-Forwarded-For entries were written by our proxy.
  // Default 1: the rightmost address is the client, so a visitor-supplied
  // leftmost value is ignored. See docs/DECISIONS.md.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default(".data/uploads"),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  /** Names this deployment in backup keys (`backups/<APP_ENV>/...`). Blank means "staging". */
  APP_ENV: z.string().default(""),
  /** Encrypts nightly database backups. Set on the WORKER only; never on web. Blank disables backups. */
  BACKUP_PASSPHRASE: z.string().default(""),
  /** Optional separate bucket for backups. Blank uses S3_BUCKET under the `backups/` prefix. */
  BACKUP_S3_BUCKET: z.string().default(""),
  RETELL_API_KEY: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  /** `live` sells through Checkout. Unset or anything else is prelaunch. */
  LAUNCH_STATE: z.string().default(""),
  DANIEL_TRANSFER_NUMBER: z.string().default(""),
  RETELL_DEFAULT_AREA_CODE: z.string().default(""),
  RETELL_DEFAULT_TOLL_FREE: z.string().default("false"),
  /** Optional E.164 fallback for marketing "Call Ava" when client zero has no public phone yet. */
  MARKETING_PHONE: z.string().default(""),
  /** OpenAI-compatible text API for the interview wizard. Feature off when TEXT_API_KEY is empty. */
  TEXT_API_BASE: z.string().default("https://openrouter.ai/api/v1"),
  TEXT_API_KEY: z.string().default(""),
  TEXT_MODEL: z.string().default("moonshotai/kimi-k2.5"),
  TEXT_FALLBACK_MODEL: z.string().default(""),
  TEXT_BUDGET_INPUT_TOKENS: z.coerce.number().int().positive().default(60_000),
  TEXT_BUDGET_OUTPUT_TOKENS: z.coerce.number().int().positive().default(12_000),
});

export type Env = z.infer<typeof envSchema>;

const PLACEHOLDER_MARKERS = ["placeholder", "change-me", "build-"] as const;

export function looksLikePlaceholderSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export function encryptionKeyByteLength(encoded: string): number {
  return Buffer.from(encoded, "base64").length;
}

function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== "production") return;
  // `next build` imports server modules while NODE_ENV is production. Those
  // build-only values are not stored in the image. Refuse them at process start.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (looksLikePlaceholderSecret(env.BETTER_AUTH_SECRET) || looksLikePlaceholderSecret(env.ENCRYPTION_KEY)) {
    throw new Error("Refusing to start: BETTER_AUTH_SECRET or ENCRYPTION_KEY looks like a placeholder");
  }
  if (encryptionKeyByteLength(env.ENCRYPTION_KEY) !== 32) {
    throw new Error("Refusing to start: ENCRYPTION_KEY must decode to 32 bytes");
  }
  // Keyring: every ENCRYPTION_KEY_V<N> is 32 bytes, keys are distinct, the active key exists.
  // Errors name the variable, never the key.
  try {
    loadKeyring(process.env);
  } catch (error) {
    throw new Error(`Refusing to start: ${error instanceof Error ? error.message : "invalid encryption keyring"}`);
  }
  if (
    env.STORAGE_DRIVER !== "s3" ||
    !env.S3_ENDPOINT ||
    !env.S3_BUCKET ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error("Refusing to start: production file storage must be a private S3 bucket");
  }
}

const PRODUCTION_APP_URLS = new Set(["https://alinstra.com", "https://www.alinstra.com"]);

export type ProductionEnvCheck = {
  APP_ENV: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BACKUP_PASSPHRASE: string;
  ENCRYPTION_KEY: string;
  ENCRYPTION_ACTIVE_KEY: string;
  APP_URL: string;
  TEXT_API_KEY: string;
  MARKETING_PHONE: string;
  LAUNCH_STATE: string;
};

function activeEncryptionKeyMissing(
  env: ProductionEnvCheck,
  keyEnv: Record<string, string | undefined>,
): boolean {
  if (!env.ENCRYPTION_KEY) return true;
  const active = (env.ENCRYPTION_ACTIVE_KEY || "1").replace(/^k/, "");
  if (active === "1") return false;
  return !keyEnv[`ENCRYPTION_KEY_V${active}`];
}

/**
 * Refuses to boot a production deployment that is missing cutover settings.
 * Live Stripe keys are required only when LAUNCH_STATE=live. Staging and local
 * return immediately. Worker also requires BACKUP_PASSPHRASE. Logs and reports
 * before throwing.
 */
export function assertProductionEnv(
  env: ProductionEnvCheck,
  options?: {
    worker?: boolean;
    report?: (error: Error) => void;
    keyEnv?: Record<string, string | undefined>;
  },
): void {
  if (env.APP_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const problems: string[] = [];
  if (env.LAUNCH_STATE === "live") {
    if (!env.STRIPE_SECRET_KEY.startsWith("sk_live_") || !env.STRIPE_WEBHOOK_SECRET) {
      problems.push("LAUNCH_STATE=live requires a live STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
    }
  } else if (!env.STRIPE_SECRET_KEY) {
    problems.push("STRIPE_SECRET_KEY must be set");
  }
  if (options?.worker && !env.BACKUP_PASSPHRASE) {
    problems.push("BACKUP_PASSPHRASE must be set on the worker");
  }
  const keyEnv = options?.keyEnv ?? process.env;
  if (activeEncryptionKeyMissing(env, keyEnv)) {
    problems.push("ENCRYPTION_KEY must be set and ENCRYPTION_ACTIVE_KEY must point at a configured key");
  }
  const appUrl = env.APP_URL.replace(/\/$/, "");
  if (!PRODUCTION_APP_URLS.has(appUrl)) {
    problems.push("APP_URL must be https://alinstra.com or https://www.alinstra.com");
  }
  if (!env.TEXT_API_KEY) problems.push("TEXT_API_KEY must be set");
  if (!env.MARKETING_PHONE) problems.push("MARKETING_PHONE must be set");
  if (problems.length === 0) return;
  const error = new Error(`Refusing to start: ${problems.join("; ")}`);
  log("error", "production.env.refused", { message: error.message });
  options?.report?.(error);
  throw error;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_TRANSPORT !== "resend") {
    throw new Error("EMAIL_TRANSPORT must be resend in production");
  }
  assertProductionSecrets(parsed.data);
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
