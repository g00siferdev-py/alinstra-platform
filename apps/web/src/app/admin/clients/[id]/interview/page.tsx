import { InterviewChat } from "@/components/interview-chat";
import { Button, PageHeader } from "@/components/ui";
import { interviewEnabled } from "@/lib/interview-config";
import { buildInterviewChecklist } from "@/lib/interview-checklist";
import { ensureInterviewSession } from "@/lib/interview-server";
import { requireAdmin } from "@/lib/session";
import { clients, type Actor } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  const exitHref = `/admin/clients/${id}/wizard`;

  return (
    <main className="grid gap-6">
      <PageHeader
        eyebrow="Setup interview"
        title={client.name}
        description="Chat through the setup. Finish writes answers into the wizard draft without overwriting fields you already filled."
        actions={
          <Link href={exitHref}>
            <Button variant="secondary">Save and exit</Button>
          </Link>
        }
      />
      <InterviewChat
        audience="admin"
        clientId={id}
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
