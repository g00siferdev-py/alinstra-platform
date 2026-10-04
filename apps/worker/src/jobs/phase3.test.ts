import { beforeEach, describe, expect, it, vi } from "vitest";

const { env, db, sent } = vi.hoisted(() => ({
  env: { APP_URL: "https://staging.alinstra.com/", ADMIN_EMAIL: "ops@alinstra.com" as string | undefined, NODE_ENV: "test" },
  db: {
    advanceProvisioning: vi.fn(),
    failProvisioning: vi.fn(async () => undefined),
    latestProvisionFailure: vi.fn(),
  },
  sent: [] as Array<{ to: string; subject: string; text: string }>,
}));

vi.mock("@alinstra/config", () => ({ getEnv: () => env, log: vi.fn() }));
vi.mock("@alinstra/db", () => ({
  ...db,
  formatLocalTime: (value: string | Date, timezone: string | undefined) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone ?? "America/New_York" }).format(new Date(value)),
  plainCallerName: (value: string) => value,
  runDueTeardowns: vi.fn(),
  syncProvisionedAgent: vi.fn(),
}));
vi.mock("@alinstra/email", async () => {
  const actual = await vi.importActual<typeof import("@alinstra/email")>("@alinstra/email");
  return {
    ...actual,
    // Fake transport: records instead of sending.
    sendEmail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
      sent.push(message);
    }),
  };
});
vi.mock("@alinstra/providers", () => ({ platformsFor: () => ({ voice: {}, billing: {} }) }));
vi.mock("@alinstra/queue", () => ({ enqueueSendAdminNotice: vi.fn() }));

import { messageEmailText, notifyProvisionFailure, runProvision } from "./phase3";

const failure = {
  clientId: "client_1",
  clientName: "North HVAC",
  stepName: "retell_number",
  stepLabel: "Buy phone number",
  error: "Retell request failed (402): Payment required. Add a card on file.",
  runOwnerEmail: "daniel@example.com",
};

describe("provisioning failure email", () => {
  beforeEach(() => {
    sent.length = 0;
    env.ADMIN_EMAIL = "ops@alinstra.com";
    db.advanceProvisioning.mockReset();
    db.latestProvisionFailure.mockReset();
    db.failProvisioning.mockClear();
  });

  it("emails the admin with the client, step label, provider error, and client link when a step fails", async () => {
    db.advanceProvisioning.mockResolvedValue({ status: "failed" });
    db.latestProvisionFailure.mockResolvedValue(failure);
    await runProvision("client_1");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ops@alinstra.com");
    expect(sent[0]?.subject).toBe('Provisioning failed for North HVAC at "Buy phone number"');
    expect(sent[0]?.text).toContain("Retell request failed (402): Payment required. Add a card on file.");
    expect(sent[0]?.text).toContain("https://staging.alinstra.com/admin/clients/client_1");
    expect(db.failProvisioning).not.toHaveBeenCalled();
  });

  it("falls back to the run owner when ADMIN_EMAIL is empty, and stays quiet when the run succeeded", async () => {
    env.ADMIN_EMAIL = "";
    db.latestProvisionFailure.mockResolvedValue(failure);
    expect(await notifyProvisionFailure("client_1")).toBe("daniel@example.com");
    expect(sent[0]?.to).toBe("daniel@example.com");
    db.latestProvisionFailure.mockResolvedValue(null);
    db.advanceProvisioning.mockResolvedValue({ status: "succeeded" });
    await runProvision("client_1");
    expect(sent).toHaveLength(1);
  });

  it("marks the run failed and still emails when provisioning throws", async () => {
    db.advanceProvisioning.mockRejectedValue(new Error("database down"));
    db.latestProvisionFailure.mockResolvedValue({ ...failure, stepLabel: "Connect and publish", error: "database down" });
    await expect(runProvision("client_1")).rejects.toThrow("database down");
    expect(db.failProvisioning).toHaveBeenCalledWith("client_1", "database down");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('stopped at the step "Connect and publish"');
  });

  it("stamps message emails with the client's local time", () => {
    const text = messageEmailText(
      { clientId: "client_1", recipients: ["a@example.com"], callerName: "Pat", body: "Heat is out", receivedAt: "2026-10-04T15:34:00.000Z", timezone: "America/New_York" },
      "https://staging.alinstra.com",
    );
    expect(text).toContain("Pat left a message at Oct 4, 11:34 AM:");
    expect(text).not.toContain("2026-10-04T15:34");
    expect(messageEmailText({ clientId: "c", recipients: ["a@example.com"], callerName: "Pat", body: "Hi" }, "https://x")).toContain("Pat left a message:");
  });
});
