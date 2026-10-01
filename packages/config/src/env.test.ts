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
});
