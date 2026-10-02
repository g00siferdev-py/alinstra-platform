import { describe, expect, it } from "vitest";
import { allowanceState, calendarMonthRange } from "./allowance";

describe("allowance", () => {
  it("splits the month on the client timezone boundary", () => {
    const stillFebruary = new Date("2026-03-01T04:30:00.000Z");
    const march = new Date("2026-03-01T05:00:00.000Z");
    const februaryRange = calendarMonthRange("America/New_York", stillFebruary);
    const marchRange = calendarMonthRange("America/New_York", march);
    expect(stillFebruary >= februaryRange.start && stillFebruary < februaryRange.end).toBe(true);
    expect(march >= februaryRange.end).toBe(true);
    expect(march >= marchRange.start && march < marchRange.end).toBe(true);
    expect(stillFebruary < marchRange.start).toBe(true);
  });

  it("treats a null allowance as unlimited and charges only past the cap", () => {
    expect(allowanceState({ included: null, used: 9, extraChangeFeeCents: 4900 })).toEqual({
      unlimited: true,
      remaining: null,
      over: false,
      feeCents: 0,
    });
    expect(allowanceState({ included: 2, used: 1, extraChangeFeeCents: 4900 })).toEqual({
      unlimited: false,
      remaining: 1,
      over: false,
      feeCents: 0,
    });
    expect(allowanceState({ included: 2, used: 2, extraChangeFeeCents: 4900 })).toEqual({
      unlimited: false,
      remaining: 0,
      over: true,
      feeCents: 4900,
    });
  });
});
