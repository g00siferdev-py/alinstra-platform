import { describe, expect, it } from "vitest";
import { filterQuery, formatCents, formatDuration, formatOffset, outcomeLabel, parseCallFilters, sentimentDisplay } from "./call-view";

describe("call view helpers", () => {
  it("formats durations, offsets, and cost", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatOffset(65.4)).toBe("1:05");
    expect(formatOffset(null)).toBe("");
    expect(formatCents(70)).toBe("$0.70");
    expect(formatCents(null)).toBe("—");
  });

  it("labels outcomes and pairs sentiment with a glyph", () => {
    expect(outcomeLabel("message_taken")).toBe("Message taken");
    expect(outcomeLabel(null)).toBe("In progress");
    expect(outcomeLabel(null, "no_final_report")).toBe("Ended (no final report)");
    expect(outcomeLabel("odd")).toBe("odd");
    expect(sentimentDisplay("Positive")).toEqual({ label: "Positive", icon: "+" });
    expect(sentimentDisplay("Negative").icon).toBe("−");
    expect(sentimentDisplay(undefined)).toEqual({ label: "Unknown", icon: "?" });
  });

  it("parses filters from the query string and rebuilds it", () => {
    const filters = parseCallFilters({ from: "2026-10-01", to: "2026-10-03", outcome: "hung_up", cursor: "abc" });
    expect(filters.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-10-03T23:59:59.999Z");
    expect(filters.outcome).toBe("hung_up");
    expect(filters.cursor).toBe("abc");
    expect(filterQuery(filters)).toBe("?from=2026-10-01&to=2026-10-03&outcome=hung_up");
    expect(filterQuery(filters, "next")).toContain("cursor=next");
    const junk = parseCallFilters({ from: "yesterday", outcome: ["nope"], cursor: "" });
    expect(junk).toMatchObject({ from: null, to: null, outcome: null, cursor: null, fromText: "", toText: "" });
    expect(filterQuery(junk)).toBe("");
  });
});
