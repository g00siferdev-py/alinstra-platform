import { reserveDocument, type Actor } from "@alinstra/db";
import { getStorage } from "@alinstra/storage";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

function adminActor(user: { id: string }): Actor {
  return { id: user.id, role: "admin" };
}

function typeForFilename(filename: string, provided: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  const canonical: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    csv: "text/csv",
  };
  return canonical[extension ?? ""] ?? provided;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session || session.user.role !== "admin" || !session.user.twoFactorEnabled) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    clientId?: string;
    filename?: string;
    contentType?: string;
    byteSize?: number;
  };
  if (!body.clientId || !body.filename || !body.byteSize) {
    return NextResponse.json({ message: "Missing upload fields." }, { status: 400 });
  }
  try {
    const contentType = typeForFilename(body.filename, body.contentType ?? "");
    const document = await reserveDocument(adminActor(session.user), {
      clientId: body.clientId,
      filename: body.filename,
      contentType,
      byteSize: body.byteSize,
    });
    const presigned = await getStorage().presignPut(document.storageKey, contentType, body.byteSize);
    if (presigned) {
      return NextResponse.json({ documentId: document.id, mode: "presigned", url: presigned });
    }
    return NextResponse.json({
      documentId: document.id,
      mode: "app",
      url: `/api/knowledge/uploads/${document.id}`,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not start the upload." },
      { status: 400 },
    );
  }
}
