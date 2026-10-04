import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("admin leads page", () => {
  it("is gated to requireAdmin", () => {
    expect(source).toContain("requireAdmin");
    expect(source).toContain("listLeads");
  });
});
