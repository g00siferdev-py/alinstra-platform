import { prisma } from "./client";
import { recordChange, type Actor } from "./changes";
import {
  assertDocumentType,
  MAX_CLIENT_BYTES,
  MAX_DOCUMENTS_PER_VERSION,
  MAX_FILE_BYTES,
  sniffDocument,
} from "./domain";
import { assertTenantContext, type TenantContext } from "./tenant";

function assertClientAccess(ctx: TenantContext, clientId: string): void {
  assertTenantContext(ctx);
  if (ctx.role !== "admin" && ctx.clientId !== clientId) {
    throw new Error("That client is not available.");
  }
}

const documentSelect = {
  id: true,
  clientId: true,
  knowledgeBaseId: true,
  storageKey: true,
  originalFilename: true,
  contentType: true,
  byteSize: true,
  extractedText: true,
  extractedTextTruncated: true,
  extractionStatus: true,
  extractionError: true,
  createdAt: true,
} as const;

export function knowledgeBases(ctx: TenantContext) {
  assertTenantContext(ctx);
  const clientFilter = ctx.role === "admin" ? {} : { clientId: ctx.clientId };
  return {
    getCurrent(clientId: string) {
      assertClientAccess(ctx, clientId);
      return prisma.knowledgeBase.findFirst({
        where: { clientId, ...clientFilter },
        orderBy: { version: "desc" },
      });
    },
  };
}

export function knowledgeDocuments(ctx: TenantContext) {
  assertTenantContext(ctx);
  const clientFilter = ctx.role === "admin" ? {} : { clientId: ctx.clientId };
  return {
    list(clientId: string) {
      assertClientAccess(ctx, clientId);
      return prisma.knowledgeDocument.findMany({
        where: { clientId, ...clientFilter },
        select: documentSelect,
        orderBy: { createdAt: "asc" },
      });
    },
    getById(id: string) {
      return prisma.knowledgeDocument.findFirst({
        where: { id, ...clientFilter },
        select: documentSelect,
      });
    },
  };
}

export async function reserveDocument(
  ctx: Actor,
  input: { clientId: string; filename: string; contentType: string; byteSize: number },
) {
  assertClientAccess(ctx, input.clientId);
  if (ctx.role !== "admin") throw new Error("Only admin can upload knowledge files");
  if (input.byteSize <= 0 || input.byteSize > MAX_FILE_BYTES) {
    throw new Error("Each file must be 10 MB or smaller.");
  }
  const extension = assertDocumentType(input.filename, input.contentType);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, archivedAt: null, wizardSubmittedAt: null },
      select: { id: true },
    });
    if (!client) throw new Error("Uploads are only open on an unsubmitted draft.");
    const knowledge = await tx.knowledgeBase.findFirst({
      where: { clientId: input.clientId, status: "draft" },
      orderBy: { version: "desc" },
    });
    if (!knowledge) throw new Error("Knowledge base is missing.");
    const existing = await tx.knowledgeDocument.findMany({
      where: { knowledgeBaseId: knowledge.id },
      select: { byteSize: true },
    });
    if (existing.length >= MAX_DOCUMENTS_PER_VERSION) {
      throw new Error("This version already has 25 files.");
    }
    const used = existing.reduce((sum, row) => sum + row.byteSize, 0);
    if (used + input.byteSize > MAX_CLIENT_BYTES) {
      throw new Error("This client is over the 50 MB file limit.");
    }
    const document = await tx.knowledgeDocument.create({
      data: {
        clientId: input.clientId,
        knowledgeBaseId: knowledge.id,
        storageKey: "pending",
        originalFilename: input.filename.slice(0, 200),
        contentType: input.contentType,
        byteSize: input.byteSize,
        extractionStatus: "pending",
      },
      select: documentSelect,
    });
    const storageKey = `clients/${input.clientId}/knowledge/${document.id}`;
    const saved = await tx.knowledgeDocument.update({
      where: { id: document.id },
      data: { storageKey },
      select: documentSelect,
    });
    await recordChange(tx, {
      clientId: input.clientId,
      actor: ctx,
      action: "knowledge.document_added",
      entityType: "knowledge_document",
      entityId: saved.id,
      summary: `Added ${saved.originalFilename}`,
      after: { filename: saved.originalFilename, byteSize: saved.byteSize, extension },
    });
    return saved;
  });
}

export async function confirmDocument(
  ctx: Actor,
  input: { documentId: string; bytes: Buffer },
) {
  const document = await knowledgeDocuments(ctx).getById(input.documentId);
  if (!document || ctx.role !== "admin") throw new Error("Document not found.");
  if (!document.storageKey.startsWith(`clients/${document.clientId}/knowledge/`)) {
    throw new Error("Document not found.");
  }
  const extension = assertDocumentType(document.originalFilename, document.contentType);
  if (input.bytes.length <= 0 || input.bytes.length > MAX_FILE_BYTES) {
    throw new Error("Each file must be 10 MB or smaller.");
  }
  sniffDocument(input.bytes, extension);
  if (input.bytes.length !== document.byteSize) {
    const others = await prisma.knowledgeDocument.findMany({
      where: { knowledgeBaseId: document.knowledgeBaseId, id: { not: document.id } },
      select: { byteSize: true },
    });
    const used = others.reduce((sum, row) => sum + row.byteSize, 0);
    if (used + input.bytes.length > MAX_CLIENT_BYTES) {
      throw new Error("This client is over the 50 MB file limit.");
    }
  }
  return prisma.knowledgeDocument.update({
    where: { id: document.id },
    data: { byteSize: input.bytes.length, extractionStatus: "pending", extractionError: null },
    select: documentSelect,
  });
}
