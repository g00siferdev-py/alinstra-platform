import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractDocumentText, ExtractionFailed, withTimeout } from "./extract";

describe("extractDocumentText", () => {
  it("reads text and truncates past the cap", async () => {
    const bytes = Buffer.from("alpha,beta\n1,2", "utf8");
    const extracted = await extractDocumentText(bytes, "hours.csv", { maxChars: 5 });
    expect(extracted.text).toBe("alpha");
    expect(extracted.truncated).toBe(true);
  });

  it("fails a malformed or oversized docx without throwing a crash error", async () => {
    await expect(extractDocumentText(Buffer.from("not-a-zip"), "notes.docx")).rejects.toBeInstanceOf(ExtractionFailed);
    const huge = new Uint8Array(64);
    huge.fill(65);
    const archive = zipSync({ "word/document.xml": huge, "pad.bin": new Uint8Array(80) });
    await expect(
      extractDocumentText(Buffer.from(archive), "notes.docx", { maxUncompressed: 40 }),
    ).rejects.toBeInstanceOf(ExtractionFailed);
  });

  it("times out a stuck extraction", async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toBeInstanceOf(ExtractionFailed);
  });
});
