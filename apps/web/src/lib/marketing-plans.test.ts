import { describe, expect, it } from "vitest";
import {
  planChangesLine,
  planMarketingFor,
  planOverageLine,
  typicalCallsRange,
} from "./marketing-plans";

describe("marketing-plans helpers", () => {
  it("computes typicalCallsRange from minutes", () => {
    expect(typicalCallsRange(100)).toEqual({ low: 35, high: 50 });
    expect(typicalCallsRange(150)).toEqual({ low: 50, high: 75 });
    expect(typicalCallsRange(300)).toEqual({ low: 100, high: 150 });
    expect(typicalCallsRange(1000)).toEqual({ low: 330, high: 500 });
    expect(typicalCallsRange(2500)).toEqual({ low: 830, high: 1250 });
  });

  it("formats changes lines", () => {
    expect(planChangesLine(1)).toBe("1 update to Ava's info each month");
    expect(planChangesLine(2)).toBe("2 updates to Ava's info each month");
    expect(planChangesLine(null)).toBe("Unlimited updates to Ava's info");
  });

  it("prefixes lowest overage only when strictly lowest among multiple plans", () => {
    const all = [
      { overagePerMinuteCents: 40, includedMinutes: 150 },
      { overagePerMinuteCents: 35, includedMinutes: 300 },
      { overagePerMinuteCents: 30, includedMinutes: 1000 },
      { overagePerMinuteCents: 25, includedMinutes: 2500 },
    ];
    expect(planOverageLine(all[3]!, all)).toBe("Our lowest rate: 25¢ a minute after 2,500");
    expect(planOverageLine(all[0]!, all)).toBe("40¢ a minute after 150");
    expect(planOverageLine(all[3]!, [all[3]!])).toBe("25¢ a minute after 2,500");
    expect(planOverageLine({ overagePerMinuteCents: 75, includedMinutes: 100 }, [{ overagePerMinuteCents: 75 }, { overagePerMinuteCents: 35 }])).toBe(
      "75¢ a minute after 100",
    );
  });

  it("falls back for unknown codes and keeps Solo without founding waiver", () => {
    expect(planMarketingFor("unknown")).toMatchObject({
      tagline: "",
      badge: null,
      staticFeatures: [],
      ctaLabel: "Get started",
      foundingWaiver: false,
    });
    expect(planMarketingFor("solo").foundingWaiver).toBe(false);
    expect(planMarketingFor("solo").badge).toBe("Self-serve");
    expect(planMarketingFor("solo").staticFeatures).toContain("Guided 20-minute setup chat");
    expect(planMarketingFor("starter").staticFeatures).toContain(
      "Hands-on setup review, plus a setup call if you want one",
    );
    expect(planMarketingFor("professional").recommended).toBe(true);
  });
});
