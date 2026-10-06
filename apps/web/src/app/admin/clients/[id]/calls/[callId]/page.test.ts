import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  logged: [] as Array<{ userId: string; role: string; callId: string }>,
}));

class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({ requireAdmin: async () => ({ user: { id: "admin_1", role: "admin", twoFactorEnabled: true } }) }));
vi.mock("@/components/call-detail", () => ({ CallDetail: () => null }));
vi.mock("@/lib/access-log", () => ({
  logCallDetailView: async (user: { id: string; role: string }, call: { id: string }) => {
    state.logged.push({ userId: user.id, role: user.role, callId: call.id });
  },
}));
vi.mock("@alinstra/db", () => ({
  clients: () => ({ getById: async (id: string) => (id === "client_1" ? { id, name: "Alpha", timezone: "America/New_York", voice: {}, callRetentionDays: 90 } : null) }),
  getCall: async (_viewer: unknown, id: string) => (id === "call_1" ? { id, clientId: "client_1", message: null, rawEvents: [{ event: "call_ended" }] } : id === "call_other" ? { id, clientId: "client_2", message: null } : null),
}));

import AdminCallDetailPage from "./page";

const render = (id: string, callId: string) => AdminCallDetailPage({ params: Promise.resolve({ id, callId }) });

describe("admin call detail page access logging", () => {
  beforeEach(() => {
    state.logged.length = 0;
  });

  it("logs the view as the admin, and nothing when the call is missing or belongs to another client", async () => {
    await render("client_1", "call_1");
    expect(state.logged).toEqual([{ userId: "admin_1", role: "admin", callId: "call_1" }]);
    await expect(render("client_1", "call_other")).rejects.toBeInstanceOf(NotFound);
    await expect(render("client_1", "call_missing")).rejects.toBeInstanceOf(NotFound);
    await expect(render("client_9", "call_1")).rejects.toBeInstanceOf(NotFound);
    expect(state.logged).toHaveLength(1);
  });
});
