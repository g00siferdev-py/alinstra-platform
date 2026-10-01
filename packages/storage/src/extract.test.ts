import { Zip, ZipDeflate, zipSync } from "fflate";
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

  it("rejects a docx zip that expands past the cap", async () => {
    const bomb = new Uint8Array(8 * 1024 * 1024);
    const archive = zipSync({ "word/document.xml": bomb });
    expect(archive.byteLength).toBeLessThan(64 * 1024);
    await expect(
      extractDocumentText(Buffer.from(archive), "notes.docx", { maxUncompressed: 64 * 1024 }),
    ).rejects.toBeInstanceOf(ExtractionFailed);
  });

  it("aborts a docx zip that hides its size and still expands past the cap", async () => {
    const payload = new Uint8Array(256 * 1024);
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    const file = new ZipDeflate("word/document.xml");
    zip.add(file);
    file.push(payload, true);
    zip.end();
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const archive = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(archive.byteLength).toBeLessThan(8 * 1024);
    await expect(
      extractDocumentText(Buffer.from(archive), "notes.docx", { maxUncompressed: 4 * 1024 }),
    ).rejects.toBeInstanceOf(ExtractionFailed);
  });

  it("times out a stuck extraction", async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toBeInstanceOf(ExtractionFailed);
  });
});
