import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyQuickUpdate, submitChangeRequest, editClientStep, setCallRetention, session } = vi.hoisted(() => ({
  applyQuickUpdate: vi.fn(),
  submitChangeRequest: vi.fn(),
  editClientStep: vi.fn(),
  setCallRetention: vi.fn(),
  session: { user: { id: "u1", role: "client_owner", clientId: "client_1" } as { id: string; role: string; clientId?: string | null } },
}));

vi.mock("@alinstra/config", () => ({ getEnv: () => ({ NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }), log: vi.fn() }));
vi.mock("@alinstra/db", () => ({ applyQuickUpdate, submitChangeRequest, editClientStep, setCallRetention }));
vi.mock("@alinstra/queue", () => ({ enqueueSyncAgent: vi.fn(async () => undefined), enqueueSendAdminNotice: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resetMemoryCounter } from "@alinstra/auth/rate-limit";
import { applyQuickUpdateAction, ownerEditClientStepAction, setCallRetentionAction, submitChangeRequestAction } from "./actions";

describe("owner edit rate limit", () => {
  const request = { category: "hours", description: "Closed Friday", confirmFee: false };

  beforeEach(() => {
    resetMemoryCounter();
    session.user = { id: "u1", role: "client_owner", clientId: "client_1" };
    applyQuickUpdate.mockReset();
    submitChangeRequest.mockReset();
    applyQuickUpdate.mockResolvedValue({ status: "applied", sync: false, notify: null, prompt: "p", truncated: false });
    submitChangeRequest.mockResolvedValue(undefined);
  });

  it("allows 30 quick updates and change requests an hour per owner, sharing one bucket", async () => {
    for (let index = 0; index < 20; index += 1) expect(await applyQuickUpdateAction({} as never)).toMatchObject({ status: "applied" });
    for (let index = 0; index < 10; index += 1) expect(await submitChangeRequestAction(request)).toEqual({ ok: true });
    const quick = await applyQuickUpdateAction({} as never);
    expect(quick).toMatchObject({ error: expect.stringMatching(/too many edits/i) });
    expect((quick as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect((quick as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(3600);
    const change = await submitChangeRequestAction(request);
    expect(change).toMatchObject({ error: expect.stringMatching(/too many edits/i) });
    expect(applyQuickUpdate).toHaveBeenCalledTimes(20);
    expect(submitChangeRequest).toHaveBeenCalledTimes(10);
  });

  it("limits per user, not per client", async () => {
    for (let index = 0; index < 30; index += 1) await submitChangeRequestAction(request);
    expect(await submitChangeRequestAction(request)).toMatchObject({ error: expect.stringMatching(/too many edits/i) });
    session.user = { id: "u2", role: "client_owner", clientId: "client_1" };
    expect(await submitChangeRequestAction(request)).toEqual({ ok: true });
  });

  it("refuses staff before they can spend an owner's allowance", async () => {
    session.user = { id: "s1", role: "client_staff", clientId: "client_1" };
    for (let index = 0; index < 40; index += 1) {
      expect(await applyQuickUpdateAction({} as never)).toEqual({ error: "Only the client owner can submit this." });
    }
    expect(applyQuickUpdate).not.toHaveBeenCalled();
  });
});

describe("owner edit actions", () => {
  beforeEach(() => {
    session.user = { id: "u1", role: "client_owner", clientId: "client_1" };
    editClientStep.mockReset();
    setCallRetention.mockReset();
  });

  it("saves an owner edit and queues a sync", async () => {
    editClientStep.mockResolvedValue({
      step: 1,
      title: "Business and contact",
      changed: [{ field: "contactName", before: "(empty)", after: "Pat" }],
      configVersion: 2,
      sync: true,
      stripeWarning: false,
    });
    const result = await ownerEditClientStepAction({ clientId: "client_1", step: 1, payload: {} });
    expect(result).toEqual({ ok: true, title: "Business and contact", changedCount: 1, configVersion: 2, sync: true, stripeWarning: false });
    expect(editClientStep).toHaveBeenCalledWith({ id: "u1", role: "client_owner", clientId: "client_1" }, { clientId: "client_1", step: 1, payload: {} });
  });

  it("refuses staff at the action level", async () => {
    session.user = { id: "s1", role: "client_staff", clientId: "client_1" };
    const result = await ownerEditClientStepAction({ clientId: "client_1", step: 1, payload: {} });
    expect(result).toEqual({ ok: false, error: "Only the client owner can submit this." });
    expect(editClientStep).not.toHaveBeenCalled();
  });

  it("refuses a foreign clientId before touching the database", async () => {
    const result = await ownerEditClientStepAction({ clientId: "client_other", step: 1, payload: {} });
    expect(result).toEqual({ ok: false, error: "That client is not available." });
    expect(editClientStep).not.toHaveBeenCalled();
  });

  it("updates call retention for the owner's client", async () => {
    setCallRetention.mockResolvedValue(undefined);
    const result = await setCallRetentionAction({ days: 30 });
    expect(result).toEqual({ ok: true });
    expect(setCallRetention).toHaveBeenCalledWith({ id: "u1", role: "client_owner", clientId: "client_1" }, { clientId: "client_1", days: 30 });
  });
});
