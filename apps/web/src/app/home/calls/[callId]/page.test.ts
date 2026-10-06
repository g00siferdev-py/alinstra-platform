import { beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string; role: string; clientId?: string | null; canViewCalls?: boolean; twoFactorEnabled?: boolean };

const state = vi.hoisted(() => ({
  user: null as null | User,
  logged: [] as Array<{ userId: string; callId: string }>,
}));

class NotFound extends Error {}

const CALL = {
  id: "call_1",
  clientId: "client_1",
  purgedAt: null,
  transcript: { turns: [{ role: "caller", text: "hi" }] },
  summary: "Summary",
  rawEvents: null,
  message: { id: "msg_1", callerName: "Jane", body: "b", createdAt: new Date() },
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ user: state.user }) }));
vi.mock("@/components/call-detail", () => ({ CallDetail: () => null }));
vi.mock("@/lib/access-log", () => ({
  logCallDetailView: async (user: { id: string }, call: { id: string }) => {
    state.logged.push({ userId: user.id, callId: call.id });
  },
}));
vi.mock("@alinstra/db", () => ({
  // Mirrors canAccessCall: owner of the client, or staff of the client with the grant.
  getCall: async (viewer: { role: string; clientId?: string; canViewCalls?: boolean }, id: string) => {
    if (id !== CALL.id) return null;
    const allowed = viewer.clientId === CALL.clientId && (viewer.role === "client_owner" || viewer.canViewCalls === true);
    return allowed ? CALL : null;
  },
  canSeeCallerNumber: () => true,
  clients: () => ({ getById: async () => ({ id: "client_1", name: "Alpha", timezone: "America/New_York", voice: {}, callRetentionDays: 90 }) }),
}));

import PortalCallDetailPage from "./page";

const render = (callId: string) => PortalCallDetailPage({ params: Promise.resolve({ callId }) });

describe("portal call detail page access logging", () => {
  beforeEach(() => {
    state.user = null;
    state.logged.length = 0;
  });

  it("logs one view for the owner and for granted staff", async () => {
    state.user = { id: "owner_1", role: "client_owner", clientId: "client_1" };
    await render("call_1");
    state.user = { id: "staff_1", role: "client_staff", clientId: "client_1", canViewCalls: true };
    await render("call_1");
    expect(state.logged).toEqual([
      { userId: "owner_1", callId: "call_1" },
      { userId: "staff_1", callId: "call_1" },
    ]);
  });

  it("logs nothing when the viewer may not see the call (404)", async () => {
    state.user = { id: "staff_2", role: "client_staff", clientId: "client_1", canViewCalls: false };
    await expect(render("call_1")).rejects.toBeInstanceOf(NotFound);
    state.user = { id: "owner_2", role: "client_owner", clientId: "client_2" };
    await expect(render("call_1")).rejects.toBeInstanceOf(NotFound);
    expect(state.logged).toEqual([]);
  });
});
