import { beforeEach, describe, expect, it, vi } from "vitest";

type Viewer = { id?: string; role: string; clientId?: string | null; canViewCalls?: boolean | null };

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; clientId?: string | null; canViewCalls?: boolean; twoFactorEnabled?: boolean },
  rangeCalls: [] as Array<[number, number]>,
  logged: [] as Array<{ userId: string; callId: string; clientId: string; range: string | null }>,
}));

const BYTES = Buffer.from("0123456789abcdef");

vi.mock("@alinstra/config", () => ({ getEnv: () => ({ NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }), log: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => (state.user ? { user: state.user } : null) }));
vi.mock("@/lib/access-log", () => ({
  logRecordingStream: async (user: { id: string }, call: { id: string; clientId: string }, request: Request) => {
    state.logged.push({ userId: user.id, callId: call.id, clientId: call.clientId, range: request.headers.get("range") });
    return true;
  },
}));
vi.mock("@alinstra/db", () => ({
  // Mirrors canAccessCall: admin → all, owner → own client, staff → own client with the grant; else null (404).
  recordingForPlayback: async (viewer: Viewer, callId: string) => {
    if (callId !== "call_1") return null;
    const call = { clientId: "client_1" };
    const allowed =
      viewer.role === "admin" ||
      (viewer.clientId === call.clientId && (viewer.role === "client_owner" || (viewer.role === "client_staff" && viewer.canViewCalls === true)));
    return allowed ? { key: "clients/client_1/calls/call_1.wav", contentType: "audio/wav", bytes: BYTES.byteLength, callId, clientId: call.clientId } : null;
  },
}));
vi.mock("@alinstra/storage", () => ({
  getStorage: () => ({
    get: async () => BYTES,
    getRange: async (_key: string, start: number, end: number) => {
      state.rangeCalls.push([start, end]);
      return BYTES.subarray(start, end + 1);
    },
    byteSize: async () => BYTES.byteLength,
  }),
}));

import { resetMemoryCounter } from "@alinstra/auth/rate-limit";
import { GET } from "./route";

function get(id: string, range?: string) {
  const headers = range ? { range } : undefined;
  return GET(new Request(`http://localhost/api/calls/${id}/recording`, { headers }), { params: Promise.resolve({ id }) });
}

const roles = {
  admin: { id: "a", role: "admin", twoFactorEnabled: true },
  adminNo2fa: { id: "a2", role: "admin", twoFactorEnabled: false },
  owner: { id: "o", role: "client_owner", clientId: "client_1" },
  foreignOwner: { id: "o2", role: "client_owner", clientId: "client_2" },
  staff: { id: "s", role: "client_staff", clientId: "client_1", canViewCalls: false },
  grantedStaff: { id: "s2", role: "client_staff", clientId: "client_1", canViewCalls: true },
  foreignGrantedStaff: { id: "s3", role: "client_staff", clientId: "client_2", canViewCalls: true },
};

describe("recording playback route", () => {
  beforeEach(() => {
    state.user = null;
    state.rangeCalls.length = 0;
    state.logged.length = 0;
    resetMemoryCounter();
  });

  it("allows 120 requests per 10 minutes per user (Range included), then 429 with Retry-After", async () => {
    state.user = roles.owner;
    for (let index = 0; index < 120; index += 1) {
      const response = await get("call_1", index % 2 === 0 ? "bytes=4-7" : undefined);
      expect(response.status).toBe(index % 2 === 0 ? 206 : 200);
    }
    const limited = await get("call_1", "bytes=4-7");
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    // Nothing is served or audited for a limited request, and the limit is per user.
    expect(state.logged).toHaveLength(120);
    state.user = roles.admin;
    expect((await get("call_1")).status).toBe(200);
  });

  it("does not count requests that have no valid session", async () => {
    for (let index = 0; index < 130; index += 1) expect((await get("call_1")).status).toBe(401);
    state.user = roles.owner;
    expect((await get("call_1")).status).toBe(200);
  });

  it("requires a session", async () => {
    expect((await get("call_1")).status).toBe(401);
    state.user = roles.adminNo2fa;
    expect((await get("call_1")).status).toBe(401);
  });

  it.each([
    ["admin", roles.admin, 200],
    ["owner of the client", roles.owner, 200],
    ["owner of another client", roles.foreignOwner, 404],
    ["staff without the grant", roles.staff, 404],
    ["staff with the grant", roles.grantedStaff, 200],
    ["granted staff of another client", roles.foreignGrantedStaff, 404],
  ])("%s", async (_label, user, status) => {
    state.user = user;
    const response = await get("call_1");
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    if (status === 200) {
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(Buffer.from(await response.arrayBuffer()).equals(BYTES)).toBe(true);
    }
  });

  it("answers 404, not 403, for unknown calls", async () => {
    state.user = roles.admin;
    expect((await get("call_missing")).status).toBe(404);
  });

  it("serves byte ranges for seeking and refuses impossible ones", async () => {
    state.user = roles.owner;
    const partial = await get("call_1", "bytes=4-7");
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 4-7/16");
    expect(partial.headers.get("content-length")).toBe("4");
    expect(Buffer.from(await partial.arrayBuffer()).toString()).toBe("4567");
    expect(state.rangeCalls).toEqual([[4, 7]]);
    const open = await get("call_1", "bytes=12-");
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 12-15/16");
    const bad = await get("call_1", "bytes=16-");
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */16");
  });

  it("writes an access-log entry for every served recording request (Range included) and none for refusals", async () => {
    await get("call_1");
    expect(state.logged).toEqual([]);
    state.user = roles.staff;
    expect((await get("call_1")).status).toBe(404);
    state.user = roles.foreignOwner;
    expect((await get("call_1")).status).toBe(404);
    expect(state.logged).toEqual([]);

    state.user = roles.owner;
    expect((await get("call_1")).status).toBe(200);
    expect((await get("call_1", "bytes=4-7")).status).toBe(206);
    expect((await get("call_1", "bytes=16-")).status).toBe(416);
    expect(state.logged).toEqual([
      { userId: "o", callId: "call_1", clientId: "client_1", range: null },
      { userId: "o", callId: "call_1", clientId: "client_1", range: "bytes=4-7" },
    ]);
  });
});
