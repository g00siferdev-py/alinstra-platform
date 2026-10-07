import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("signup page when signed in", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  it("shows the signed-in card instead of the form when a session exists", () => {
    expect(source).toContain("getSession");
    expect(source).toContain("SignedInSignupCard");
    expect(source).toContain("SignupForm");
    expect(source).toMatch(/if \(session\)/);
  });
});
