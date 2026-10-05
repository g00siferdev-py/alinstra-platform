import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin interview page", () => {
  it("gates on requireAdmin and interviewEnabled", () => {
    const source = readFileSync(resolve(import.meta.dirname, "page.tsx"), "utf8");
    expect(source).toContain("requireAdmin");
    expect(source).toContain("interviewEnabled");
    expect(source).toContain("notFound()");
  });
});
