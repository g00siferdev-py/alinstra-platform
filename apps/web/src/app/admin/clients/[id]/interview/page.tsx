import { InterviewChat } from "@/components/interview-chat";
import { interviewEnabled } from "@/lib/interview-config";
import { ensureInterviewSession } from "@/lib/interview-server";
import { requireAdmin } from "@/lib/session";
import { clients, type Actor } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDiscardInterview, adminFinishInterview, adminSendInterviewMessage } from "./actions";

export default async function AdminInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!interviewEnabled()) notFound();
  const session = await requireAdmin();
  const { id } = await params;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();

  const actor: Actor = { id: session.user.id, role: "admin" };
  const interview = await ensureInterviewSession(actor, id, client.industry);
  const state = interview.state as {
    transcript?: Array<{ role: "user" | "assistant"; content: string }>;
    collected?: Record<string, unknown>;
    done?: boolean;
  };

  return (
    <main className="mx-auto grid max-w-4xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}/wizard`}>
        Back to wizard
      </Link>
      <h1 className="text-2xl font-semibold">Interview · {client.name}</h1>
      <p className="text-sm text-[var(--muted)]">
        Chat through the setup. Finish writes answers into the wizard draft without overwriting fields you already filled.
      </p>
      <InterviewChat
        sessionId={interview.id}
        initialTranscript={state.transcript ?? []}
        initialCaptured={state.collected ?? {}}
        initialDone={interview.status !== "active" || state.done === true}
        sendAction={adminSendInterviewMessage}
        finishAction={(sessionId) => adminFinishInterview(sessionId, id)}
        discardAction={(sessionId) => adminDiscardInterview(sessionId, id)}
      />
    </main>
  );
}
