import { InterviewChat } from "@/components/interview-chat";
import { Button, PageHeader } from "@/components/ui";
import { interviewEnabled } from "@/lib/interview-config";
import { buildInterviewChecklist } from "@/lib/interview-checklist";
import { ensureInterviewSession } from "@/lib/interview-server";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import { clients, type Actor } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function OwnerInterviewPage() {
  if (!interviewEnabled()) notFound();
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();

  const ctx = { role: "client_owner" as const, clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client || client.wizardSubmittedAt) notFound();

  const actor: Actor = { id: session.user.id, role: "client_owner", clientId: session.user.clientId };
  const interview = await ensureInterviewSession(actor, session.user.clientId, client.industry);
  const state = interview.state as {
    transcript?: Array<{ role: "user" | "assistant"; content: string }>;
    collected?: Record<string, unknown>;
    done?: boolean;
    answeredQuestions?: string[];
    openQuestions?: string[];
    skippedQuestions?: string[];
    currentQuestionId?: string | null;
    industry?: string;
  };
  const checklist = buildInterviewChecklist({
    industry: state.industry ?? client.industry,
    answeredQuestions: state.answeredQuestions,
    openQuestions: state.openQuestions,
    skippedQuestions: state.skippedQuestions,
    currentQuestionId: state.currentQuestionId,
  });
  const exitHref = "/home/business/setup";

  return (
    <main className="grid gap-6">
      <PageHeader
        eyebrow="Setup interview"
        title={client.name}
        description="Answer a few short questions. You can review and edit everything in the form before anything goes live."
        actions={
          <Link href={exitHref}>
            <Button variant="secondary">Save and exit</Button>
          </Link>
        }
      />
      <InterviewChat
        audience="owner"
        clientId={session.user.clientId}
        sessionId={interview.id}
        initialTranscript={state.transcript ?? []}
        initialCaptured={state.collected ?? {}}
        initialDone={interview.status !== "active" || state.done === true}
        checklist={checklist}
        exitHref={exitHref}
      />
    </main>
  );
}
