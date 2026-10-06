import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string; role: string; clientId?: string | null };

const state = vi.hoisted(() => ({
  user: null as null | User,
  listCalls: [] as Array<{ ctx: Record<string, unknown>; filter: Record<string, unknown> }>,
}));

class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ user: state.user }) }));
vi.mock("@/components/access-log-table", () => ({ AccessLogTable: () => null }));
vi.mock("@alinstra/db", () => ({
  clients: (ctx: { clientId: string }) => ({ getById: async (id: string) => (id === ctx.clientId ? { id, name: "Alpha", timezone: "America/New_York" } : null) }),
  accessLogs: (ctx: Record<string, unknown>) => ({
    list: async (filter: Record<string, unknown>) => {
      state.listCalls.push({ ctx, filter });
      return { rows: [], total: 0, page: 1, pageSize: 50 };
    },
  }),
}));

import WhoViewedPage from "./page";
import { AccessLogTable } from "@/components/access-log-table";

function findTable(node: unknown): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: unknown } & Record<string, unknown>>;
  if (element.type === AccessLogTable) return element;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findTable(child);
    if (found) return found;
  }
  return null;
}

const render = (query: Record<string, string> = {}) => WhoViewedPage({ searchParams: Promise.resolve(query) });

describe("owner 'Who viewed your calls' page", () => {
  beforeEach(() => {
    state.user = null;
    state.listCalls.length = 0;
  });

  it("is a 404 for staff, admins, and users without a client; the log is never queried", async () => {
    for (const user of [
      { id: "s", role: "client_staff", clientId: "client_1" },
      { id: "a", role: "admin" },
      { id: "o", role: "client_owner", clientId: null },
    ]) {
      state.user = user;
      await expect(render()).rejects.toBeInstanceOf(NotFound);
    }
    expect(state.listCalls).toEqual([]);
  });

  it("pins the query to the owner's own client even if the URL asks for another one", async () => {
    state.user = { id: "o", role: "client_owner", clientId: "client_1" };
    const tree = await render({ client: "client_2", actor: "someone", action: "message.list" });
    expect(state.listCalls).toHaveLength(1);
    expect(state.listCalls[0]!.ctx).toEqual({ role: "client_owner", clientId: "client_1" });
    // Only action, dates, and page are forwarded; no client or actor filter reaches the repository.
    expect(Object.keys(state.listCalls[0]!.filter).sort()).toEqual(["action", "from", "page", "to"]);
    expect(state.listCalls[0]!.filter.action).toBe("message.list");
    const table = findTable(tree);
    expect(table?.props.admin).toBe(false);
    expect(table?.props.clients).toBeUndefined();
    expect(table?.props.exportHref).toBeUndefined();
  });
});
