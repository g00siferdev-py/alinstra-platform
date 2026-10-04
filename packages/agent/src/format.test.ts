import { describe, expect, it } from "vitest";
import { formatLocalTime, formatPhone } from "./format";

describe("shared formatters", () => {
  it("renders client-local time as MMM d, h:mm a", () => {
    const moment = new Date("2026-10-04T15:34:00.000Z");
    expect(formatLocalTime(moment, "America/New_York")).toBe("Oct 4, 11:34 AM");
    expect(formatLocalTime(moment, "America/Los_Angeles")).toBe("Oct 4, 8:34 AM");
    expect(formatLocalTime(moment.toISOString(), "Not/AZone")).toBe("Oct 4, 11:34 AM");
    expect(formatLocalTime("garbage", "America/New_York")).toBe("");
  });

  it("formats NANP numbers for people and leaves others alone", () => {
    expect(formatPhone("+18883871525")).toBe("+1 (888) 387-1525");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone(null)).toBe("");
  });
});
