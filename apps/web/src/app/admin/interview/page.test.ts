import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin interview settings page", () => {
  it("is gated to requireAdmin and shows banks/prompt panels", () => {
    const source = readFileSync(resolve(import.meta.dirname, "page.tsx"), "utf8");
    expect(source).toContain("requireAdmin");
    expect(source).toContain("INTERVIEW_SYSTEM_PROMPT");
    expect(source).toContain("listLoadedBanks");
    expect(source).toContain("listInterviewSessions");
  });
});
