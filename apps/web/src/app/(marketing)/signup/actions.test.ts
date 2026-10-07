import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, createSelfServeClient, headersMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  createSelfServeClient: vi.fn(),
  headersMock: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.9" })),
}));

vi.mock("@alinstra/auth", () => ({
  AuthError: class AuthError extends Error {},
  auth: { api: { getSession, signInEmail: vi.fn(), sendVerificationEmail: vi.fn() } },
  clientIp: () => "203.0.113.9",
  createCredentialUser: vi.fn(),
  getCounter: () => ({ increment: async () => 1 }),
  MIN_PASSWORD_LENGTH: 12,
}));
vi.mock("@alinstra/db", () => ({
  abandonSelfServeClient: vi.fn(),
  attachSelfServeSignup: vi.fn(),
  createSelfServeClient,
  emailAlreadyRegistered: vi.fn(async () => false),
  ensureSelfServeCheckout: vi.fn(),
  TERMS_VERSION: "2026-01",
}));
vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ APP_URL: "http://localhost:3000" }),
  log: vi.fn(),
}));
vi.mock("@alinstra/providers", () => ({ platformsFor: () => ({ billing: {} }) }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { signupAction } from "./actions";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("signupAction when signed in", () => {
  beforeEach(() => {
    getSession.mockReset();
    createSelfServeClient.mockReset();
  });

  it("refuses to create an account while a session exists", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", email: "admin@example.com", role: "admin" } });
    const result = await signupAction(
      null,
      form({
        businessName: "New Co",
        ownerName: "Pat",
        email: "pat@example.com",
        mobilePhone: "+14235550100",
        password: "ScreenshotOwner1!",
        planId: "plan_1",
        terms: "true",
        company_url: "",
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: "You're already signed in. Sign out first to create a new account.",
    });
    expect(createSelfServeClient).not.toHaveBeenCalled();
  });
});
