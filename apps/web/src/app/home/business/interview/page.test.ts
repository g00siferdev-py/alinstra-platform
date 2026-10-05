import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner interview page", () => {
  it("requires client_owner, hides after submit, and avoids action closures", () => {
    const source = readFileSync(resolve(import.meta.dirname, "page.tsx"), "utf8");
    expect(source).toContain('role !== "client_owner"');
    expect(source).toContain("wizardSubmittedAt");
    expect(source).toContain("interviewEnabled");
    expect(source).toContain("notFound()");
    expect(source).toContain('audience="owner"');
    expect(source).not.toMatch(/finishAction=\{/);
    expect(source).not.toMatch(/discardAction=\{/);
  });
});
