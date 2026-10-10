import { getEnv } from "@alinstra/config";
import {
  postInterviewMessage,
  resolveTextInterviewConfig,
  textPlatformFor,
  type Actor,
} from "@alinstra/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function actorFromSession(session: Awaited<ReturnType<typeof requireUser>>): Actor | null {
  if (session.user.role === "admin") return { id: session.user.id, role: "admin" };
  if (session.user.role === "client_owner" && session.user.clientId) {
    return { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireUser();
  const actor = actorFromSession(session);
  if (!actor) return Response.json({ ok: false, error: "Not allowed." }, { status: 403 });

  const body = (await request.json()) as {
    sessionId?: string;
    message?: string;
    clientMessageId?: string;
  };
  const sessionId = body.sessionId?.trim() ?? "";
  const message = body.message?.trim() ?? "";
  const clientMessageId = body.clientMessageId?.trim() ?? "";
  if (!sessionId || !message || !clientMessageId) {
    return Response.json({ ok: false, error: "Missing fields." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const config = await resolveTextInterviewConfig(getEnv());
        const text = textPlatformFor(config);
        if (!config.enabled || !text) throw new Error("The interview assistant is not configured.");
        const result = await postInterviewMessage(actor, {
          sessionId,
          message,
          clientMessageId,
          text,
          budget: { inputTokens: config.budgetInputTokens, outputTokens: config.budgetOutputTokens },
          onDelta: (confirmation) => send({ type: "token", text: confirmation }),
        });
        if (!result.ok) {
          send({
            type: "done",
            ok: false,
            conflict: true,
            transcript: (result.session.state as { transcript?: unknown }).transcript ?? [],
            captured: (result.session.state as { collected?: unknown }).collected ?? {},
            done: result.session.status !== "active",
          });
        } else {
          const state = result.session.state as { transcript?: unknown; collected?: unknown; done?: boolean };
          send({
            type: "done",
            ok: true,
            reply: result.reply,
            done: result.done || state.done === true,
            transcript: state.transcript ?? [],
            captured: state.collected ?? {},
          });
        }
      } catch (error) {
        send({
          type: "done",
          ok: false,
          error: error instanceof Error ? error.message : "Could not send that.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
