import { beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string; role: string; clientId?: string | null; twoFactorEnabled?: boolean };

const state = vi.hoisted(() => ({
  user: null as null | User,
  logged: [] as Array<{ userId: string; documentId: string; clientId: string }>,
}));

const DOCUMENT = { id: "doc_1", clientId: "client_1", storageKey: "clients/client_1/knowledge/doc_1", originalFilename: "price list.pdf", contentType: "application/pdf" };

vi.mock("@alinstra/config", () => ({ getEnv: () => ({ NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }), log: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => (state.user ? { user: state.user } : null) }));
vi.mock("@/lib/access-log", () => ({
  logDocumentDownload: async (user: { id: string }, document: { id: string; clientId: string }) => {
    state.logged.push({ userId: user.id, documentId: document.id, clientId: document.clientId });
  },
}));
vi.mock("@alinstra/db", () => ({
  // Mirrors the scoped repository: admin sees any document, a portal user only their own client's.
  knowledgeDocuments: (ctx: { role: string; clientId?: string }) => ({
    getById: async (id: string) => (id === DOCUMENT.id && (ctx.role === "admin" || ctx.clientId === DOCUMENT.clientId) ? DOCUMENT : null),
  }),
}));
vi.mock("@alinstra/storage", () => ({
  attachmentDisposition: (name: string) => `attachment; filename="${name}"`,
  getStorage: () => ({ presignGet: async () => null, get: async () => Buffer.from("pdf bytes") }),
}));

import { resetMemoryCounter } from "@alinstra/auth/rate-limit";
import { GET } from "./route";

const get = (id: string) => GET(new Request(`http://localhost/api/knowledge/documents/${id}`), { params: Promise.resolve({ id }) });

describe("knowledge document download route", () => {
  beforeEach(() => {
    state.user = null;
    state.logged.length = 0;
    resetMemoryCounter();
  });

  it("allows 60 downloads per 10 minutes per user, then 429 with Retry-After", async () => {
    state.user = { id: "owner_1", role: "client_owner", clientId: "client_1" };
    for (let index = 0; index < 60; index += 1) expect((await get("doc_1")).status).toBe(200);
    const limited = await get("doc_1");
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    // A limited request is not served or audited, and another user is unaffected.
    expect(state.logged).toHaveLength(60);
    state.user = { id: "staff_1", role: "client_staff", clientId: "client_1" };
    expect((await get("doc_1")).status).toBe(200);
  });

  it("does not count requests without a session", async () => {
    for (let index = 0; index < 70; index += 1) expect((await get("doc_1")).status).toBe(401);
    state.user = { id: "owner_1", role: "client_owner", clientId: "client_1" };
    expect((await get("doc_1")).status).toBe(200);
  });

  it("logs a download for the document's client, for admins and the owning client's users", async () => {
    state.user = { id: "admin_1", role: "admin", twoFactorEnabled: true };
    expect((await get("doc_1")).status).toBe(200);
    state.user = { id: "owner_1", role: "client_owner", clientId: "client_1" };
    expect((await get("doc_1")).status).toBe(200);
    state.user = { id: "staff_1", role: "client_staff", clientId: "client_1" };
    expect((await get("doc_1")).status).toBe(200);
    expect(state.logged).toEqual([
      { userId: "admin_1", documentId: "doc_1", clientId: "client_1" },
      { userId: "owner_1", documentId: "doc_1", clientId: "client_1" },
      { userId: "staff_1", documentId: "doc_1", clientId: "client_1" },
    ]);
  });

  it("logs nothing when the request is refused", async () => {
    expect((await get("doc_1")).status).toBe(401);
    state.user = { id: "admin_2", role: "admin", twoFactorEnabled: false };
    expect((await get("doc_1")).status).toBe(401);
    state.user = { id: "owner_2", role: "client_owner", clientId: "client_2" };
    expect((await get("doc_1")).status).toBe(404);
    state.user = { id: "admin_1", role: "admin", twoFactorEnabled: true };
    expect((await get("doc_missing")).status).toBe(404);
    expect(state.logged).toEqual([]);
  });
});
