import { describe, expect, it } from "vitest";
import { isTollFree } from "./marketing-phone";

describe("isTollFree", () => {
  it("detects +1 8xx toll-free NPAs", () => {
    expect(isTollFree("+18883871525")).toBe(true);
    expect(isTollFree("+18005551212")).toBe(true);
    expect(isTollFree("+18335551212")).toBe(true);
    expect(isTollFree("+14235550100")).toBe(false);
    expect(isTollFree(null)).toBe(false);
    expect(isTollFree("")).toBe(false);
  });
});
