import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { createLead, leadAdminNotice, listLeads, markLeadContacted, parseLeadInput } from "./leads";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_leads", role: "admin" as const };

describe("leads", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves a lead and builds the admin notice", async () => {
    const lead = await createLead({
      business: "North HVAC",
      name: "Pat Owner",
      phone: "+14155550100",
      email: "pat@example.com",
      industry: "hvac-home-services",
      missedCalls: "5_to_15",
      notes: "After-hours coverage",
    });
    expect(lead.business).toBe("North HVAC");
    const notice = leadAdminNotice(lead);
    expect(notice.subject).toBe("New lead: North HVAC");
    expect(notice.text).toContain("Pat Owner");
    expect(notice.text).toContain("HVAC & home services");
  });

  it("lists newest first for admin and marks contacted", async () => {
    await createLead({
      business: "Older",
      name: "A",
      phone: "1",
      email: "a@example.com",
      industry: "veterinary",
      missedCalls: "under_5",
    });
    await createLead({
      business: "Newer",
      name: "B",
      phone: "2",
      email: "b@example.com",
      industry: "other:Dental",
      missedCalls: "over_15",
    });
    const listed = await listLeads(admin);
    expect(listed.map((row) => row.business)).toEqual(["Newer", "Older"]);
    await markLeadContacted(admin, listed[0]!.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: listed[0]!.id } })).contactedAt).toBeTruthy();
    await expect(listLeads({ role: "client_owner", clientId: "c1" })).rejects.toThrow(/admin/i);
  });

  it("rejects incomplete lead input", () => {
    expect(() =>
      parseLeadInput({ business: "", name: "A", phone: "1", email: "a@b.com", industry: "hvac-home-services", missedCalls: "under_5" }),
    ).toThrow(/business name/i);
  });
});
