import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  gate: "ok" as "ok" | "no-2fa" | "not-admin",
  queried: [] as Array<Record<string, unknown>>,
}));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("@/lib/session", () => ({
  // Same contract as the real requireAdmin(): non-admins go to /home, admins without two-factor go to enrol.
  requireAdmin: async () => {
    if (state.gate === "not-admin") throw new Redirect("/home");
    if (state.gate === "no-2fa") throw new Redirect("/account/security");
    return { user: { id: "admin_1", role: "admin", twoFactorEnabled: true } };
  },
}));
vi.mock("@/components/access-log-table", () => ({ AccessLogTable: () => null }));
vi.mock("@alinstra/db", () => ({
  DEFAULT_TIMEZONE: "America/New_York",
  clients: () => ({ list: async () => [{ id: "client_1", name: "Alpha" }] }),
  accessLogs: () => ({
    list: async (filter: Record<string, unknown>) => {
      state.queried.push(filter);
      return { rows: [], total: 0, page: 1, pageSize: 50 };
    },
  }),
}));

import AdminAccessPage from "./page";

describe("admin /admin/access page", () => {
  beforeEach(() => {
    state.gate = "ok";
    state.queried.length = 0;
  });

  it("uses the same requireAdmin 2FA gate as Services, before touching the log", async () => {
    const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(source).toContain("requireAdmin");
    state.gate = "no-2fa";
    await expect(AdminAccessPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/account/security" });
    state.gate = "not-admin";
    await expect(AdminAccessPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/home" });
    expect(state.queried).toEqual([]);
  });

  it("passes the filters and page through to the repository", async () => {
    await AdminAccessPage({ searchParams: Promise.resolve({ client: "client_1", actor: "dana", action: "message.list", from: "2026-10-01", page: "2" }) });
    expect(state.queried).toHaveLength(1);
    expect(state.queried[0]).toMatchObject({ clientId: "client_1", actor: "dana", action: "message.list", page: 2 });
    expect((state.queried[0]!.from as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
