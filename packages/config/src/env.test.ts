import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "./env";

const snapshot = { ...process.env };

const required = {
  APP_URL: "https://app.example.com",
  BETTER_AUTH_URL: "https://app.example.com",
  ADMIN_EMAIL: "admin@example.com",
  DATABASE_URL: "postgresql://alinstra:alinstra@localhost:5432/alinstra",
  REDIS_URL: "redis://localhost:6379",
  EMAIL_FROM: "notifications@alinstra.com",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_test_key",
} as const;

function useEnv(overrides: Record<string, string | undefined>): void {
  resetEnvCache();
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
  for (const [key, value] of Object.entries({ ...required, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  resetEnvCache();
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
});

describe("production secret guard", () => {
  const realKey = randomBytes(32).toString("base64");
  const realSecret = randomBytes(32).toString("base64");

  it("refuses placeholder markers in production", () => {
    useEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "build-time-placeholder-secret-32-chars-min",
      ENCRYPTION_KEY: realKey,
    });
    expect(() => getEnv()).toThrow(/placeholder/);

    useEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: "change-me-generate-a-32-byte-base64-key",
    });
    expect(() => getEnv()).toThrow(/placeholder/);
  });

  it("refuses an encryption key that does not decode to 32 bytes", () => {
    useEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: Buffer.from("too-short").toString("base64"),
    });
    expect(() => getEnv()).toThrow(/32 bytes/);
  });

  it("accepts real production secrets and skips the guard during next build", () => {
    useEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_BUCKET: "alinstra-production",
      S3_ACCESS_KEY_ID: "r2-access",
      S3_SECRET_ACCESS_KEY: "r2-secret",
    });
    expect(getEnv().ENCRYPTION_KEY).toBe(realKey);

    useEnv({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
      BETTER_AUTH_SECRET: "build-time-placeholder-secret-32-chars-min",
      ENCRYPTION_KEY: "build-time-placeholder-not-a-real-key",
    });
    expect(() => getEnv()).not.toThrow();
  });

  describe("encryption keyring", () => {
    const prodBase = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_BUCKET: "alinstra-production",
      S3_ACCESS_KEY_ID: "r2-access",
      S3_SECRET_ACCESS_KEY: "r2-secret",
    };
    const keyTwo = randomBytes(32).toString("base64");

    it("accepts a valid second key and an active key", () => {
      useEnv({ ...prodBase, ENCRYPTION_KEY_V2: keyTwo, ENCRYPTION_ACTIVE_KEY: "2" });
      expect(() => getEnv()).not.toThrow();
    });

    it("refuses, naming the variable and never the key, when a key is wrong", () => {
      const short = Buffer.from("short").toString("base64");
      useEnv({ ...prodBase, ENCRYPTION_KEY_V2: short });
      expect(() => getEnv()).toThrow(/ENCRYPTION_KEY_V2 must be 32 bytes/);
      resetEnvCache();
      try {
        getEnv();
      } catch (error) {
        expect((error as Error).message).not.toContain(short);
        expect((error as Error).message).not.toContain(realKey);
      }
    });

    it("refuses duplicate keys and a missing active key", () => {
      useEnv({ ...prodBase, ENCRYPTION_KEY_V2: realKey });
      expect(() => getEnv()).toThrow(/duplicates/);
      useEnv({ ...prodBase, ENCRYPTION_ACTIVE_KEY: "2" });
      expect(() => getEnv()).toThrow(/ENCRYPTION_ACTIVE_KEY points at k2/);
    });
  });

  it("accepts optional MARKETING_PHONE", () => {
    useEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
      MARKETING_PHONE: "+18883871525",
    });
    expect(getEnv().MARKETING_PHONE).toBe("+18883871525");

    useEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
      MARKETING_PHONE: undefined,
    });
    expect(getEnv().MARKETING_PHONE).toBe("");
  });

  it("defaults text interview env and accepts overrides", () => {
    useEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
    });
    const defaults = getEnv();
    expect(defaults.TEXT_API_KEY).toBe("");
    expect(defaults.TEXT_API_BASE).toBe("https://openrouter.ai/api/v1");
    expect(defaults.TEXT_MODEL).toBe("moonshotai/kimi-k2.5");
    expect(defaults.TEXT_BUDGET_INPUT_TOKENS).toBe(60_000);
    expect(defaults.TEXT_BUDGET_OUTPUT_TOKENS).toBe(12_000);

    useEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: realSecret,
      ENCRYPTION_KEY: realKey,
      TEXT_API_KEY: "sk-test",
      TEXT_MODEL: "custom/model",
      TEXT_BUDGET_INPUT_TOKENS: "1000",
    });
    expect(getEnv().TEXT_API_KEY).toBe("sk-test");
    expect(getEnv().TEXT_MODEL).toBe("custom/model");
    expect(getEnv().TEXT_BUDGET_INPUT_TOKENS).toBe(1000);
  });
});
