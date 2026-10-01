import { describe, expect, it } from "vitest";
import { attachmentDisposition } from "./index";

describe("attachmentDisposition", () => {
  it("forces attachment and strips characters that break the header", () => {
    expect(attachmentDisposition('hours\r\n.txt";.pdf')).toBe('attachment; filename="hours__.txt__.pdf"');
    expect(attachmentDisposition("   ")).toBe('attachment; filename="download"');
  });
});
