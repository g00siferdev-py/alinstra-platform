import { MAX_EXTRACTED_CHARS, prisma, sealCipher } from "@alinstra/db";
import { log } from "@alinstra/config";
import { extractDocumentText, ExtractionFailed, getStorage } from "@alinstra/storage";

const FAILED_MESSAGE = "The document could not be read.";

// Exception: the worker updates extraction status for one document id. See docs/DECISIONS.md.
export async function extractKnowledge(documentId: string): Promise<void> {
  const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) return;
  try {
    const bytes = await getStorage().get(document.storageKey);
    const extracted = await extractDocumentText(bytes, document.originalFilename, { maxChars: MAX_EXTRACTED_CHARS });
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        extractionStatus: "done",
        // Encrypted at rest (Phase S); the legacy plaintext column is cleared.
        extractedText: null,
        extractedTextCipher: sealCipher(extracted.text),
        extractedTextTruncated: extracted.truncated,
        extractionError: null,
      },
    });
  } catch (error) {
    log("error", "knowledge extraction failed", {
      documentId,
      error: error instanceof Error ? error.name : "unknown",
    });
    const message = error instanceof ExtractionFailed ? error.message : FAILED_MESSAGE;
    await markExtractionFailed(documentId, message);
  }
}

export async function markExtractionFailed(documentId: string, message: string): Promise<void> {
  await prisma.knowledgeDocument.updateMany({
    where: { id: documentId },
    data: { extractionStatus: "failed", extractionError: message, extractedText: null, extractedTextCipher: null },
  });
}
