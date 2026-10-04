import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueSyncAgent, editClientStep } = vi.hoisted(() => ({
  enqueueSyncAgent: vi.fn(async () => undefined),
  editClientStep: vi.fn(),
}));

vi.mock("@alinstra/auth", () => ({ AuthError: class AuthError extends Error {}, createInvite: vi.fn() }));
vi.mock("@alinstra/config", () => ({ log: vi.fn() }));
vi.mock("@alinstra/storage", () => ({ getStorage: () => ({ delete: vi.fn() }) }));
vi.mock("@alinstra/queue", () => ({ enqueueSyncAgent }));
vi.mock("@alinstra/db", () => ({ editClientStep }));
vi.mock("@/lib/session", () => ({ requireAdmin: async () => ({ user: { id: "admin_1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { editClientStepAction } from "./actions";

const saved = { step: 4, title: "Coverage", changed: [{ field: "afterHours", before: "(empty)", after: "x" }], configVersion: 3, stripeWarning: false };

describe("editClientStepAction", () => {
  beforeEach(() => {
    enqueueSyncAgent.mockClear();
    editClientStep.mockReset();
  });

  it("enqueues exactly one sync job for a provisioned client when Ava is affected", async () => {
    editClientStep.mockResolvedValue({ ...saved, sync: true });
    const result = await editClientStepAction({ clientId: "client_1", step: 4, payload: {} });
    expect(result).toEqual({ ok: true, title: "Coverage", changedCount: 1, configVersion: 3, sync: true, stripeWarning: false });
    expect(enqueueSyncAgent).toHaveBeenCalledTimes(1);
    expect(enqueueSyncAgent).toHaveBeenCalledWith({ clientId: "client_1" });
    expect(editClientStep).toHaveBeenCalledWith({ id: "admin_1", role: "admin" }, { clientId: "client_1", step: 4, payload: {} });
  });

  it("skips the sync job when the step does not reach Ava", async () => {
    editClientStep.mockResolvedValue({ ...saved, step: 10, title: "Portal access", configVersion: null, sync: false });
    const result = await editClientStepAction({ clientId: "client_1", step: 10, payload: {} });
    expect(result).toMatchObject({ ok: true, sync: false, configVersion: null });
    expect(enqueueSyncAgent).not.toHaveBeenCalled();
  });

  it("returns the validation message instead of throwing", async () => {
    editClientStep.mockRejectedValue(new Error("Enter the public phone as +1 followed by 10 digits, like +18883871525."));
    const result = await editClientStepAction({ clientId: "client_1", step: 1, payload: {} });
    expect(result).toEqual({ ok: false, error: "Enter the public phone as +1 followed by 10 digits, like +18883871525." });
    expect(enqueueSyncAgent).not.toHaveBeenCalled();
  });
});
