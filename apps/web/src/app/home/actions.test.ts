import { beforeEach, describe, expect, it, vi } from "vitest";

const { editClientStep, setCallRetention, session } = vi.hoisted(() => ({
  editClientStep: vi.fn(),
  setCallRetention: vi.fn(),
  session: { user: { id: "u1", role: "client_owner", clientId: "client_1" } as { id: string; role: string; clientId?: string | null } },
}));

vi.mock("@alinstra/config", () => ({ log: vi.fn() }));
vi.mock("@alinstra/db", () => ({ editClientStep, setCallRetention }));
vi.mock("@alinstra/queue", () => ({ enqueueSyncAgent: vi.fn(async () => undefined), enqueueSendAdminNotice: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ownerEditClientStepAction, setCallRetentionAction } from "./actions";

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
