import { knowledgeDocuments, type TenantContext } from "@alinstra/db";
import { attachmentDisposition, getStorage } from "@alinstra/storage";
import { logDocumentDownload } from "@/lib/access-log";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (session.user.role === "admin" && !session.user.twoFactorEnabled) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const ctx: TenantContext =
    session.user.role === "admin"
      ? { role: "admin" }
      : { role: session.user.role === "client_owner" ? "client_owner" : "client_staff", clientId: session.user.clientId ?? "" };
  if (ctx.role !== "admin" && !ctx.clientId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const document = await knowledgeDocuments(ctx).getById(id);
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });
  await logDocumentDownload(session.user, { id: document.id, clientId: document.clientId }, request);
  const disposition = attachmentDisposition(document.originalFilename);
  const signed = await getStorage().presignGet(document.storageKey, disposition);
  if (signed) return NextResponse.redirect(signed);
  const bytes = await getStorage().get(document.storageKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": document.contentType,
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
