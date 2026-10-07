import { banksFor, resolveInterviewIndustry } from "@alinstra/db";
import type { InterviewChecklistItem } from "@/components/interview-chat";

const TOPIC_LABELS: Record<string, string> = {
  "gen.hours": "Hours",
  "gen.services": "Services",
  "gen.faqs": "Common questions",
  "gen.pricing": "Pricing",
  "gen.transfers": "Transfers",
  "gen.nobody_picks_up": "Missed calls",
  "gen.after_hours": "After hours",
  "gen.messages": "Messages",
  "gen.greeting": "Greeting",
  "gen.tone": "Tone",
  "gen.do_not_say": "Do-not-say",
  "hvac.emergency": "Emergencies",
  "hvac.service_area": "Service area",
  "vet.appointments": "Appointments",
  "vet.medical": "Medical limits",
};

function labelFor(id: string, question: string): string {
  if (TOPIC_LABELS[id]) return TOPIC_LABELS[id]!;
  const short = question.split(/[?.!]/)[0] ?? question;
  return short.length > 36 ? `${short.slice(0, 34)}…` : short;
}

export function buildInterviewChecklist(input: {
  industry: string | null | undefined;
  answeredQuestions?: string[];
  openQuestions?: string[];
  skippedQuestions?: string[];
  currentQuestionId?: string | null;
}): InterviewChecklistItem[] {
  const industry = resolveInterviewIndustry(input.industry);
  const items = banksFor(industry);
  const answered = new Set(input.answeredQuestions ?? []);
  const skipped = new Set(input.skippedQuestions ?? []);
  const open = input.openQuestions ?? [];
  const currentId = input.currentQuestionId ?? open[0] ?? null;

  return items.map((item) => {
    let status: InterviewChecklistItem["status"] = "todo";
    if (answered.has(item.id) || skipped.has(item.id)) status = "done";
    else if (currentId === item.id) status = "now";
    return {
      id: item.id,
      label: labelFor(item.id, item.question),
      status,
    };
  });
}
