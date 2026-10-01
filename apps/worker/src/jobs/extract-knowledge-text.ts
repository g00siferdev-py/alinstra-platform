import { EXTRACT_TIMEOUT_MS, MAX_EXTRACTED_CHARS, prisma } from "@alinstra/db";
import { log } from "@alinstra/config";
import { extractDocumentText, ExtractionFailed, getStorage, withTimeout } from "@alinstra/storage";

// Exception: the worker updates extraction status for one document id. See docs/DECISIONS.md.
export async function extractKnowledge(documentId: string): Promise<void> {
  const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) return;
  try {
    const bytes = await getStorage().get(document.storageKey);
    const extracted = await withTimeout(
      extractDocumentText(bytes, document.originalFilename, { maxChars: MAX_EXTRACTED_CHARS }),
      EXTRACT_TIMEOUT_MS,
    );
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        extractionStatus: "done",
        extractedText: extracted.text,
        extractedTextTruncated: extracted.truncated,
        extractionError: null,
      },
    });
  } catch (error) {
    log("error", "knowledge extraction failed", {
      documentId,
      error: error instanceof Error ? error.name : "unknown",
    });
    const message = error instanceof ExtractionFailed ? error.message : "The document could not be read.";
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { extractionStatus: "failed", extractionError: message, extractedText: null },
    });
  }
}
