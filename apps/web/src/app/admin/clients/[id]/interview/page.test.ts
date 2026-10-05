import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin client interview page", () => {
  it("gates on requireAdmin and interviewEnabled without action closures", () => {
    const source = readFileSync(resolve(import.meta.dirname, "page.tsx"), "utf8");
    expect(source).toContain("requireAdmin");
    expect(source).toContain("interviewEnabled");
    expect(source).toContain("notFound()");
    expect(source).toContain('audience="admin"');
    expect(source).not.toMatch(/finishAction=\{/);
    expect(source).not.toMatch(/discardAction=\{/);
  });
});
