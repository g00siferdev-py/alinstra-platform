import { describe, expect, it } from "vitest";
import { accessCsv, accessQuery, parseAccessFilters } from "./access-view";

const row = {
  id: "a1",
  at: new Date("2026-10-05T12:00:00.000Z"),
  actorUserId: "admin_1",
  actorRole: "admin",
  actorLabel: "Daniel (daniel@example.com)",
  clientId: "client_1",
  clientName: 'Smith, "Best" Plumbing',
  action: "call.transcript.view",
  actionLabel: "Viewed a call transcript",
  entityType: "call_record",
  entityId: "call_1",
  ip: "203.0.113.9",
  userAgent: "=HYPERLINK(\"http://evil\")",
  impersonating: false,
  count: null,
};

describe("access view helpers", () => {
  it("parses filters, ignoring unknown actions and malformed dates", () => {
    const filters = parseAccessFilters({ client: "client_1", actor: " dana@x.com ", action: "call.raw.view", from: "2026-10-01", to: "2026-10-05", page: "3" });
    expect(filters).toMatchObject({ clientId: "client_1", actor: "dana@x.com", action: "call.raw.view", fromText: "2026-10-01", toText: "2026-10-05", page: 3 });
    expect(filters.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-10-05T23:59:59.999Z");
    const bad = parseAccessFilters({ action: "drop table", from: "yesterday", page: "-4" });
    expect(bad).toMatchObject({ action: null, from: null, fromText: "", page: 1 });
  });

  it("round-trips filters into a query string and omits the client when scoped", () => {
    const filters = parseAccessFilters({ client: "client_1", action: "message.list", from: "2026-10-01" });
    expect(accessQuery(filters)).toBe("?client=client_1&action=message.list&from=2026-10-01");
    expect(accessQuery(filters, { page: 2, omit: ["client"] })).toBe("?action=message.list&from=2026-10-01&page=2");
    expect(accessQuery(parseAccessFilters({}))).toBe("");
  });

  it("exports CSV with quoted cells and neutralised spreadsheet formulas", () => {
    const csv = accessCsv([row]);
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toBe("at,client_id,client,actor_id,actor,actor_role,action,entity_type,entity_id,count,ip,user_agent,impersonating");
    expect(line).toContain('"Smith, ""Best"" Plumbing"');
    expect(line).toContain("2026-10-05T12:00:00.000Z");
    expect(line).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(line!.endsWith(",false")).toBe(true);
  });
});
