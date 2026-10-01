import { confirmDocument, type Actor } from "@alinstra/db";
import { enqueueExtractKnowledge } from "@alinstra/queue";
import { getStorage } from "@alinstra/storage";

export async function storeAndExtract(actor: Actor, documentId: string, bytes: Buffer): Promise<void> {
  const document = await confirmDocument(actor, { documentId, bytes });
  await getStorage().put(document.storageKey, bytes, document.contentType);
  await enqueueExtractKnowledge({ documentId: document.id });
}
