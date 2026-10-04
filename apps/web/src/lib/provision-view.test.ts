import { describe, expect, it } from "vitest";
import { numberCostText, provisionHeadline } from "./provision-view";

const labels: Record<string, string> = {
  stripe_customer: "Create billing account",
  stripe_checkout: "Create payment link",
  retell_llm: "Build receptionist",
  retell_agent: "Create voice agent",
  retell_number: "Buy phone number",
  retell_bind: "Connect and publish",
};

function steps(statuses: Record<string, string>, errors: Record<string, string> = {}) {
  return Object.keys(labels).map((name) => ({ name, label: labels[name]!, status: statuses[name] ?? "pending", error: errors[name] ?? null }));
}

describe("provision status block", () => {
  it("reads Not provisioned before any run", () => {
    expect(provisionHeadline({ status: "lead", phoneDisplay: null, runStatus: null, runKind: null, steps: [] })).toEqual({ tone: "muted", text: "Not provisioned" });
  });

  it("counts the step in progress out of six", () => {
    const headline = provisionHeadline({
      status: "provisioning",
      phoneDisplay: null,
      runStatus: "running",
      runKind: "provision",
      steps: steps({ stripe_customer: "succeeded", stripe_checkout: "succeeded", retell_llm: "running" }),
    });
    expect(headline).toEqual({ tone: "running", text: "Provisioning — step 3 of 6: Build receptionist" });
  });

  it("waits for approval instead of buying a number", () => {
    const headline = provisionHeadline({
      status: "provisioning",
      phoneDisplay: null,
      runStatus: "running",
      runKind: "provision",
      steps: steps({ stripe_customer: "succeeded", stripe_checkout: "succeeded", retell_llm: "succeeded", retell_agent: "succeeded", retell_number: "awaiting_approval" }),
    });
    expect(headline.text).toBe("Waiting for your approval to buy a phone number");
  });

  it("shows Live with the formatted number", () => {
    expect(provisionHeadline({ status: "live", phoneDisplay: "+1 (888) 387-1525", runStatus: "succeeded", runKind: "provision", steps: [] })).toEqual({
      tone: "live",
      text: "Live · +1 (888) 387-1525",
    });
  });

  it("names the failed step with the first line of the error and keeps the full text", () => {
    const error = "Retell request failed (402): Payment required.\nAdd a card on file.";
    const headline = provisionHeadline({
      status: "provisioning",
      phoneDisplay: null,
      runStatus: "failed",
      runKind: "provision",
      steps: steps({ stripe_customer: "succeeded", stripe_checkout: "succeeded", retell_llm: "succeeded", retell_agent: "succeeded", retell_number: "failed" }, { retell_number: error }),
    });
    expect(headline.tone).toBe("failed");
    expect(headline.text).toBe("Failed at Buy phone number: Retell request failed (402): Payment required.");
    expect(headline.error).toBe(error);
  });

  it("states the monthly cost for toll-free and local numbers", () => {
    expect(numberCostText({ tollFree: true, areaCode: null, monthlyCents: 500, inboundPerMinuteCents: 6 })).toContain("Buy a toll-free number for $5/month plus $0.06 per inbound minute.");
    expect(numberCostText({ tollFree: false, areaCode: "415", monthlyCents: 200, inboundPerMinuteCents: 0 })).toContain("Buy a local number in area code 415 for $2/month.");
  });
});
