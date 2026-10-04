import { describe, expect, it } from "vitest";
import { callViewerFor, parseByteRange } from "./call-viewer";

describe("callViewerFor", () => {
  it("maps roles and refuses admins without 2FA or portal users without a client", () => {
    expect(callViewerFor({ id: "a", role: "admin", twoFactorEnabled: true })).toEqual({ id: "a", role: "admin" });
    expect(callViewerFor({ id: "a", role: "admin", twoFactorEnabled: false })).toBeNull();
    expect(callViewerFor({ id: "o", role: "client_owner", clientId: "c1" })).toEqual({ id: "o", role: "client_owner", clientId: "c1" });
    expect(callViewerFor({ id: "o", role: "client_owner", clientId: null })).toBeNull();
    expect(callViewerFor({ id: "s", role: "client_staff", clientId: "c1" })).toEqual({ id: "s", role: "client_staff", clientId: "c1", canViewCalls: false });
    expect(callViewerFor({ id: "s", role: "client_staff", clientId: "c1", canViewCalls: true })).toMatchObject({ canViewCalls: true });
  });
});

describe("parseByteRange", () => {
  it("handles open, closed, suffix, and bad ranges", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseByteRange("items=0-1", 100)).toBeNull();
  });
});
