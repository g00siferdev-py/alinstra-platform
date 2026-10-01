import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(1),
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
