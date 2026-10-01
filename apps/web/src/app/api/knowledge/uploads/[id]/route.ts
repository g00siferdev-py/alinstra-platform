import { knowledgeDocuments, MAX_FILE_BYTES, type Actor } from "@alinstra/db";
import { getStorage } from "@alinstra/storage";
import { storeAndExtract } from "@/lib/knowledge-upload";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

function adminActor(user: { id: string }): Actor {
  return { id: user.id, role: "admin" };
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session || session.user.role !== "admin" || !session.user.twoFactorEnabled) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) {
    return NextResponse.json({ message: "Each file must be 10 MB or smaller." }, { status: 400 });
  }
  try {
    await storeAndExtract(adminActor(session.user), id, bytes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not store the file." },
      { status: 400 },
    );
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session || session.user.role !== "admin" || !session.user.twoFactorEnabled) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const actor = adminActor(session.user);
  const document = await knowledgeDocuments(actor).getById(id);
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });
  const bytes = await getStorage().get(document.storageKey);
  try {
    await storeAndExtract(actor, id, bytes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not confirm the upload." },
      { status: 400 },
    );
  }
}
