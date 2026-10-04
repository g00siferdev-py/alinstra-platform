import { beforeEach, describe, expect, it, vi } from "vitest";

const { createLead, leadAdminNotice, enqueueSendAdminNotice, increment, headersMock } = vi.hoisted(() => ({
  createLead: vi.fn(),
  leadAdminNotice: vi.fn(() => ({ subject: "New lead: North", text: "body" })),
  enqueueSendAdminNotice: vi.fn(async () => undefined),
  increment: vi.fn(async () => 1),
  headersMock: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.9" })),
}));

vi.mock("@alinstra/db", () => ({ createLead, leadAdminNotice }));
vi.mock("@alinstra/queue", () => ({ enqueueSendAdminNotice }));
vi.mock("@alinstra/auth", () => ({
  clientIp: () => "203.0.113.9",
  getCounter: () => ({ increment, get: async () => 0, clear: async () => undefined }),
}));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { submitLeadAction } from "./actions";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const valid = {
  business: "North HVAC",
  name: "Pat",
  phone: "555-0100",
  email: "pat@example.com",
  industry: "hvac_home",
  industryOther: "",
  missedCalls: "5_to_15",
  notes: "",
  company_url: "",
};

describe("submitLeadAction", () => {
  beforeEach(() => {
    createLead.mockReset();
    enqueueSendAdminNotice.mockReset();
    increment.mockReset();
    increment.mockResolvedValue(1);
    createLead.mockResolvedValue({
      business: "North HVAC",
      name: "Pat",
      phone: "555-0100",
      email: "pat@example.com",
      industry: "hvac_home",
      missedCalls: "5_to_15",
      notes: null,
    });
  });

  it("saves a lead and enqueues the admin email", async () => {
    const result = await submitLeadAction(null, form(valid));
    expect(result).toEqual({ ok: true });
    expect(createLead).toHaveBeenCalled();
    expect(enqueueSendAdminNotice).toHaveBeenCalledWith({ subject: "New lead: North", text: "body" });
  });

  it("rejects a filled honeypot without saving", async () => {
    const result = await submitLeadAction(null, form({ ...valid, company_url: "https://spam.test" }));
    expect(result).toEqual({ ok: true });
    expect(createLead).not.toHaveBeenCalled();
    expect(enqueueSendAdminNotice).not.toHaveBeenCalled();
  });

  it("rate limits after five submissions per IP", async () => {
    increment.mockResolvedValue(6);
    const result = await submitLeadAction(null, form(valid));
    expect(result).toEqual({ ok: false, error: "Too many submissions from this network. Try again in an hour." });
    expect(createLead).not.toHaveBeenCalled();
  });
});
