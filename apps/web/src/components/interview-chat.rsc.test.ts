import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(import.meta.dirname, "..");

function read(relative: string): string {
  return readFileSync(resolve(srcRoot, relative), "utf8");
}

describe("interview RSC → client props", () => {
  it("admin and owner interview pages pass only serializable props to InterviewChat", () => {
    const admin = read("app/admin/clients/[id]/interview/page.tsx");
    const owner = read("app/home/business/interview/page.tsx");
    for (const source of [admin, owner]) {
      expect(source).toContain("<InterviewChat");
      expect(source).toContain('audience="');
      expect(source).toContain("clientId=");
      expect(source).toContain("sessionId=");
      // Closures / action props across the RSC boundary are forbidden.
      expect(source).not.toMatch(/finishAction=\{/);
      expect(source).not.toMatch(/discardAction=\{/);
      expect(source).not.toMatch(/sendAction=\{/);
      expect(source).not.toMatch(/=>\s*\w*(Finish|Discard|Send)/);
    }
  });

  it("InterviewChat imports server actions itself instead of receiving closures", () => {
    const source = read("components/interview-chat.tsx");
    expect(source).toContain('"use client"');
    expect(source).toContain("adminFinishInterview");
    expect(source).toContain("adminDiscardInterview");
    expect(source).toContain("ownerFinishInterview");
    expect(source).toContain("ownerDiscardInterview");
    expect(source).not.toMatch(/finishAction\s*:/);
    expect(source).not.toMatch(/discardAction\s*:/);
    expect(source).not.toMatch(/sendAction\s*:/);
  });

  it("admin settings page does not pass function props to InterviewSettingsForm", () => {
    const page = read("app/admin/interview/page.tsx");
    const form = read("components/interview-settings-form.tsx");
    expect(page).toContain("<InterviewSettingsForm");
    expect(page).toMatch(/defaults=\{\{/);
    expect(page).not.toMatch(/InterviewSettingsForm[\s\S]*?=\{\s*\(/);
    expect(form).toContain('"use client"');
    expect(form).toContain("saveInterviewSettingsAction");
    expect(form).toContain("useActionState(saveInterviewSettingsAction");
  });
});
