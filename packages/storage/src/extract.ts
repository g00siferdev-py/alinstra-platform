import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
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

function readDocx(bytes: Buffer, maxUncompressed: number): void {
  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  let total = 0;
  let failed = false;
  let sawDocument = false;

  unzipper.onfile = (file: UnzipFile) => {
    if (file.name.replaceAll("\\", "/") === "word/document.xml") sawDocument = true;
    const declared = file.originalSize;
    if (failed || (typeof declared === "number" && total + declared > maxUncompressed)) {
      failed = true;
      file.terminate();
      return;
    }
    file.ondata = (error, data) => {
      if (failed || error || !data) {
        failed = true;
        return;
      }
      total += data.byteLength;
      if (total > maxUncompressed) {
        failed = true;
        file.terminate();
      }
    };
    try {
      file.start();
    } catch {
      failed = true;
    }
  };

  const input = new Uint8Array(bytes);
  try {
    const chunkSize = 256;
    for (let offset = 0; offset < input.length && !failed; offset += chunkSize) {
      const next = Math.min(offset + chunkSize, input.length);
      unzipper.push(input.subarray(offset, next), next === input.length);
    }
  } catch {
    throw new ExtractionFailed("The document could not be read.");
  }
  if (failed || !sawDocument) throw new ExtractionFailed("The document could not be read.");
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
