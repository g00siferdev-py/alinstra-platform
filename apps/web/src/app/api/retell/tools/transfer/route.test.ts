import { describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ RETELL_API_KEY: "key", NODE_ENV: "test", TRUSTED_PROXY_HOPS: 1 }),
  log: vi.fn(),
}));
vi.mock("@alinstra/providers", () => ({ verifyRetell: () => true }));
vi.mock("@alinstra/db", () => ({
  TRANSFER_UNAVAILABLE: "I can't transfer this call. I'll take a message instead.",
  clientIdForRetellAgent: vi.fn(async (agentId: string) => (agentId === "agent_1" ? "client_1" : null)),
  decideTransfer: vi.fn(async (_clientId: string, args: { target?: string; number?: string }) => {
    if (args.target === "explode") throw new Error("database down");
    if (args.target?.toLowerCase() === "front desk" || args.number === "+14155550100") return { allowed: true, tool: "transfer_front_desk" };
    return { allowed: false, reason: "That person is not on the transfer list. Offer to take a message instead." };
  }),
}));

import { POST } from "./route";

function call(body: unknown) {
  return POST(new Request("http://localhost/api/retell/tools/transfer", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

describe("transfer check route", () => {
  it("resolves a label, accepts a legacy number, and never echoes digits", async () => {
    const byLabel = await call({ call: { agent_id: "agent_1" }, args: { target: "Front Desk" } });
    expect(await byLabel.json()).toEqual({ allowed: true, tool: "transfer_front_desk" });
    const legacy = await call({ call: { agent_id: "agent_1" }, args: { number: "+14155550100" } });
    const legacyText = JSON.stringify(await legacy.json());
    expect(legacyText).toContain('"allowed":true');
    expect(legacyText).not.toMatch(/\d{7,}/);
    const unknown = await call({ call: { agent_id: "agent_1" }, args: { target: "Dr. Nobody" } });
    expect(await unknown.json()).toMatchObject({ allowed: false });
  });

  it("never returns 500 and says it cannot transfer when the agent is unknown or the lookup fails", async () => {
    const noAgent = await call({ call: { agent_id: "other" }, args: { target: "Front desk" } });
    expect(noAgent.status).toBe(200);
    expect(await noAgent.json()).toEqual({ allowed: false, reason: "I can't transfer this call. I'll take a message instead." });
    const failed = await call({ call: { agent_id: "agent_1" }, args: { target: "explode" } });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ allowed: false });
  });
});
