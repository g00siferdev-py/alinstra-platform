import { beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string; role: string; clientId?: string | null; twoFactorEnabled?: boolean };

const state = vi.hoisted(() => ({
  user: null as null | User,
  exports: [] as Array<{ ctx: Record<string, unknown>; filter: Record<string, unknown> }>,
}));

vi.mock("@/lib/session", () => ({ getSession: async () => (state.user ? { user: state.user } : null) }));
vi.mock("@alinstra/db", () => ({
  accessLogs: (ctx: Record<string, unknown>) => ({
    exportRows: async (filter: Record<string, unknown>) => {
      state.exports.push({ ctx, filter });
      return [
        {
          id: "a1",
          at: new Date("2026-10-05T12:00:00.000Z"),
          actorUserId: "admin_1",
          actorRole: "admin",
          actorLabel: "Daniel (d@example.com)",
          clientId: "client_1",
          clientName: "Alpha",
          action: "call.transcript.view",
          actionLabel: "Viewed a call transcript",
          entityType: "call_record",
          entityId: "call_1",
          ip: "203.0.113.9",
          userAgent: "UA",
          impersonating: false,
          count: null,
        },
      ];
    },
  }),
}));

import { GET } from "./route";

const get = (query = "") => GET(new Request(`http://localhost/admin/access/export${query}`));

describe("access log CSV export", () => {
  beforeEach(() => {
    state.user = null;
    state.exports.length = 0;
  });

  it("requires a signed-in admin with two-factor, like the Services page", async () => {
    expect((await get()).status).toBe(401);
    state.user = { id: "o", role: "client_owner", clientId: "client_1" };
    expect((await get()).status).toBe(404);
    state.user = { id: "s", role: "client_staff", clientId: "client_1" };
    expect((await get()).status).toBe(404);
    state.user = { id: "a", role: "admin", twoFactorEnabled: false };
    expect((await get()).status).toBe(401);
    expect(state.exports).toEqual([]);
  });

  it("returns the filtered rows as a private, no-store CSV attachment", async () => {
    state.user = { id: "a", role: "admin", twoFactorEnabled: true };
    const response = await get("?client=client_1&action=call.transcript.view&from=2026-10-01&to=2026-10-05&actor=daniel");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="alinstra-access-log-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.exports[0]!.ctx).toEqual({ role: "admin" });
    expect(state.exports[0]!.filter).toMatchObject({ clientId: "client_1", action: "call.transcript.view", actor: "daniel" });
    const text = await response.text();
    expect(text.split("\r\n")[0]).toContain("at,client_id,client");
    expect(text).toContain("call.transcript.view,call_record,call_1");
  });
});
