import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const DEFAULT_UNCOMPRESSED_CAP = 30 * 1024 * 1024;

export class ExtractionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionFailed";
  }
}

function extensionOf(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function readDocx(bytes: Buffer, maxUncompressed: number): Buffer {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new ExtractionFailed("The document could not be read.");
  }
  let total = 0;
  for (const entry of Object.values(entries)) {
    total += entry.byteLength;
    if (total > maxUncompressed) throw new ExtractionFailed("The document could not be read.");
  }
  if (!entries["word/document.xml"]) throw new ExtractionFailed("The document could not be read.");
  return bytes;
}

export async function extractDocumentText(
  bytes: Buffer,
  filename: string,
  options?: { maxChars?: number; maxUncompressed?: number },
): Promise<{ text: string; truncated: boolean }> {
  const maxChars = options?.maxChars ?? 200_000;
  const maxUncompressed = options?.maxUncompressed ?? DEFAULT_UNCOMPRESSED_CAP;
  const extension = extensionOf(filename);
  let text = "";
  if (extension === "docx") {
    readDocx(bytes, maxUncompressed);
    try {
      const result = await mammoth.extractRawText({ buffer: bytes });
      text = result.value;
    } catch {
      throw new ExtractionFailed("The document could not be read.");
    }
  } else if (extension === "pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractText(pdf, { mergePages: true });
      text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    } catch {
      throw new ExtractionFailed("The document could not be read.");
    }
  } else if (extension === "txt" || extension === "csv") {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ExtractionFailed("The document could not be read.");
    }
  } else {
    throw new ExtractionFailed("The document could not be read.");
  }
  return truncate(text.replaceAll("\u0000", ""), maxChars);
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ExtractionFailed("Extraction timed out.")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
