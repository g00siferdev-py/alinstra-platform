import { describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({ RETELL_API_KEY: "key" }),
}));
vi.mock("@alinstra/providers", () => ({ verifyRetell: () => true }));
vi.mock("@alinstra/db", () => ({
  inboundCallPayload: vi.fn(async (to: string) => {
    if (to === "explode") throw new Error("database down");
    return {
      dynamic_variables: { office_open: "yes", allowed_targets: "Front desk; Billing" },
      agent_override: { retell_llm: { begin_message: "Thank you for calling. How can I help?" } },
    };
  }),
}));

import { POST } from "./route";

function call(body: unknown) {
  return POST(new Request("http://localhost/api/retell/inbound", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

describe("inbound webhook", () => {
  it("reads call_inbound and answers under call_inbound with begin_message override", async () => {
    const response = await call({
      event: "call_inbound",
      call_inbound: { to_number: "+18005550100", from_number: "+14155550199" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      call_inbound: {
        dynamic_variables: { office_open: "yes", allowed_targets: "Front desk; Billing" },
        agent_override: { retell_llm: { begin_message: "Thank you for calling. How can I help?" } },
      },
    });
  });

  it("answers with unknown variables when the lookup fails", async () => {
    const response = await call({ event: "call_inbound", call_inbound: { to_number: "explode" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      call_inbound: { dynamic_variables: { office_open: "unknown", allowed_targets: "" } },
    });
  });
});
