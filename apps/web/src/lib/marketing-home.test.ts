import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { marketingPhoneDisplay, marketingTelHref } from "./marketing-phone";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("marketing home route", () => {
  it("serves / from the marketing page without a login redirect", () => {
    expect(existsSync(`${root}/app/page.tsx`)).toBe(false);
    const source = readFileSync(`${root}/app/(marketing)/page.tsx`, "utf8");
    expect(source).toContain("The calls you miss are the ones that mattered.");
    expect(source).not.toMatch(/\bredirect\s*\(/);
    expect(source).not.toContain("email or text");
    expect(source).not.toContain("Most popular");
    expect(source).toContain('id="pricing"');
    expect(source).toContain("PlanCards");
  });

  it("formats the Call Ava CTA phone for display and tel links", () => {
    expect(marketingPhoneDisplay("+18883871525")).toBe("(888) 387-1525");
    expect(marketingTelHref("+18883871525")).toBe("tel:+18883871525");
  });
});

describe("marketing pricing route", () => {
  it("does not advertise follow-up per-booking pricing", () => {
    const source = readFileSync(`${root}/app/(marketing)/pricing/page.tsx`, "utf8");
    expect(source).not.toContain("per booking");
    expect(source).not.toContain("recallMonthlyCents");
    expect(source).not.toContain("recallPerBookingCents");
    expect(source).toContain("Ask about pricing");
  });
});
