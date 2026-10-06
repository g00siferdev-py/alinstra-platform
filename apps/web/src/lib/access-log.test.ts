import { beforeEach, describe, expect, it, vi } from "vitest";

type Entry = { actorUserId: string; actorRole: string; clientId: string; action: string; entityType: string; entityId: string; ip?: string | null; userAgent?: string | null; count?: number | null; impersonating?: boolean };
type Options = { onError?: (error: unknown, ids: Record<string, string>) => void; shouldWrite?: () => Promise<boolean> };

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  headers: {} as Record<string, string>,
  counts: new Map<string, number>(),
  failInsert: false,
  failCounter: false,
  captured: [] as Array<{ error: Error; context: { extra?: Record<string, unknown>; tags?: Record<string, unknown> } }>,
  logged: [] as Array<{ level: string; message: string; fields: Record<string, unknown> }>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(state.headers) }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (error: Error, context: { extra?: Record<string, unknown> }) => state.captured.push({ error, context }),
}));
vi.mock("@alinstra/config", () => ({
  log: (level: string, message: string, fields: Record<string, unknown>) => state.logged.push({ level, message, fields }),
}));
vi.mock("@alinstra/auth", () => ({
  clientIp: (request: Request) => request.headers.get("x-real-ip") ?? "local",
  getCounter: () => ({
    increment: async (key: string) => {
      if (state.failCounter) throw new Error("redis down");
      const next = (state.counts.get(key) ?? 0) + 1;
      state.counts.set(key, next);
      return next;
    },
    get: async () => 0,
    clear: async () => undefined,
  }),
}));
vi.mock("@alinstra/db", () => ({
  recordAccess: async (entry: Entry, options: Options = {}) => {
    const ids = { actorUserId: entry.actorUserId, clientId: entry.clientId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId };
    if (options.shouldWrite) {
      let write = true;
      try {
        write = await options.shouldWrite();
      } catch {
        write = true;
      }
      if (!write) return false;
    }
    if (state.failInsert) {
      options.onError?.(new Error("insert failed near Jane Doe +14235550198 'please call me back'"), ids);
      return false;
    }
    state.rows.push({ ...entry });
    return true;
  },
}));

import { logAccess, logCallDetailView, logDocumentDownload, logMessageList, logRecordingStream } from "./access-log";

const admin = { id: "admin_1", role: "admin" };
const owner = { id: "owner_1", role: "client_owner", clientId: "client_1" };
const staff = { id: "staff_1", role: "client_staff", clientId: "client_1" };

const call = {
  id: "call_1",
  clientId: "client_1",
  purgedAt: null as Date | null,
  transcript: { turns: [{ text: "hello" }] } as unknown,
  summary: "A summary" as string | null,
  rawEvents: [{ event: "call_ended" }] as unknown[] | null,
  message: { id: "msg_1" } as { id: string } | null,
};

describe("web access logging", () => {
  beforeEach(() => {
    state.rows.length = 0;
    state.counts.clear();
    state.captured.length = 0;
    state.logged.length = 0;
    state.failInsert = false;
    state.failCounter = false;
    state.headers = { "x-real-ip": "203.0.113.5", "user-agent": "UnitTest/1.0" };
  });

  it("writes transcript, raw-events, and message rows for an admin opening a call, with request metadata", async () => {
    await logCallDetailView(admin, call);
    expect(state.rows.map((row) => [row.action, row.entityType, row.entityId])).toEqual([
      ["call.transcript.view", "call_record", "call_1"],
      ["call.raw.view", "call_record", "call_1"],
      ["message.view", "client_message", "msg_1"],
    ]);
    expect(state.rows.every((row) => row.actorUserId === "admin_1" && row.actorRole === "admin" && row.clientId === "client_1")).toBe(true);
    expect(state.rows.every((row) => row.ip === "203.0.113.5" && row.userAgent === "UnitTest/1.0" && row.impersonating === false)).toBe(true);
  });

  it("owners and staff never get a raw-events row, and a purged or empty call logs no transcript view", async () => {
    await logCallDetailView(owner, { ...call, rawEvents: null });
    expect(state.rows.map((row) => row.action)).toEqual(["call.transcript.view", "message.view"]);
    state.rows.length = 0;
    await logCallDetailView(staff, { ...call, rawEvents: null, message: null });
    expect(state.rows.map((row) => [row.action, row.actorRole])).toEqual([["call.transcript.view", "client_staff"]]);
    state.rows.length = 0;
    await logCallDetailView(owner, { ...call, purgedAt: new Date(), transcript: null, summary: null, rawEvents: null, message: null });
    expect(state.rows).toEqual([]);
  });

  it("logs one recording row per call per actor per window, including Range requests, and writes anyway when Redis fails", async () => {
    const request = new Request("http://localhost/api/calls/call_1/recording", { headers: { range: "bytes=0-9", "x-real-ip": "198.51.100.2", "user-agent": "Player" } });
    expect(await logRecordingStream(owner, { id: "call_1", clientId: "client_1" }, request)).toBe(true);
    expect(await logRecordingStream(owner, { id: "call_1", clientId: "client_1" }, request)).toBe(false);
    expect(await logRecordingStream(owner, { id: "call_1", clientId: "client_1" }, request)).toBe(false);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ action: "call.recording.stream", entityType: "call_record", entityId: "call_1", ip: "198.51.100.2", userAgent: "Player" });

    // A different actor, and a different call, each get their own row.
    expect(await logRecordingStream(staff, { id: "call_1", clientId: "client_1" }, request)).toBe(true);
    expect(await logRecordingStream(owner, { id: "call_2", clientId: "client_1" }, request)).toBe(true);
    expect(state.rows).toHaveLength(3);

    state.failCounter = true;
    expect(await logRecordingStream(owner, { id: "call_1", clientId: "client_1" }, request)).toBe(true);
    expect(state.rows).toHaveLength(4);
  });

  it("logs a message list as one row with the count, and skips an empty list", async () => {
    await logMessageList(owner, "client_1", 6);
    await logMessageList(admin, "client_1", 0);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ action: "message.list", entityType: "client", entityId: "client_1", count: 6, actorUserId: "owner_1" });
  });

  it("logs a knowledge document download against the document's client", async () => {
    await logDocumentDownload(admin, { id: "doc_1", clientId: "client_9" }, new Request("http://localhost/api/knowledge/documents/doc_1", { headers: { "user-agent": "Browser" } }));
    expect(state.rows[0]).toMatchObject({ action: "knowledge.document.download", entityType: "knowledge_document", entityId: "doc_1", clientId: "client_9", userAgent: "Browser" });
  });

  it("reports a failed insert to Sentry with ids only, never the database error text", async () => {
    state.failInsert = true;
    const written = await logAccess(owner, { action: "message.view", clientId: "client_1", entityType: "client_message", entityId: "msg_7" });
    expect(written).toBe(false);
    expect(state.captured).toHaveLength(1);
    const { error, context } = state.captured[0]!;
    expect(error.message).not.toMatch(/Jane|4235550198|call me back/);
    expect(context.extra).toEqual({ actorUserId: "owner_1", clientId: "client_1", action: "message.view", entityType: "client_message", entityId: "msg_7" });
    expect(JSON.stringify(state.logged)).not.toMatch(/Jane|4235550198|call me back/);
  });

  it("ignores users with an unknown role", async () => {
    expect(await logAccess({ id: "x", role: "mystery" }, { action: "message.list", clientId: "client_1", entityType: "client", entityId: "client_1", count: 1 })).toBe(false);
    expect(state.rows).toEqual([]);
  });
});
