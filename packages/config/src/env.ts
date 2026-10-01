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
});

export type Env = z.infer<typeof envSchema>;

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
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
