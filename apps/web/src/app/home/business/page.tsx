import { CallRetentionForm } from "@/components/call-retention-form";
import { QuickUpdateForms } from "@/components/quick-update-forms";
import {
  AGENT_AFFECTING_STEPS,
  clients,
  faqItems,
  formatTransferTargets,
  knowledgeBases,
  OWNER_BLOCKED_STEP_HINT,
  OWNER_BLOCKED_STEPS,
  plans,
  transferTargets,
  WIZARD_STEP_TITLES,
} from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function MyBusinessPage() {
  const session = await requireUser();
  if (session.user.role === "admin" || !session.user.clientId) notFound();
  const ctx = { role: session.user.role as "client_owner" | "client_staff", clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client) notFound();
  const [plan, knowledge, targets] = await Promise.all([
    client.planId ? plans(ctx).getById(client.planId) : Promise.resolve(null),
    knowledgeBases(ctx).getCurrent(session.user.clientId),
    transferTargets(ctx).list(session.user.clientId),
  ]);
  const owner = session.user.role === "client_owner";
  const faqs = faqItems(knowledge?.faqs);
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">Home</Link>
      <h1 className="text-2xl font-semibold">My business</h1>
      <p className="text-sm text-[var(--muted)]">
        {owner
          ? "Edit each section below, or use the quick updates for hours, notices, staff, and one FAQ at a time."
          : "Read only. Ask the account owner to change hours, notices, staff, or FAQs."}
      </p>
      <section className="rounded-xl border border-[var(--line)] p-4 text-sm">
        <p>{client.name}{client.namePronunciation ? ` · pronounced ${client.namePronunciation}` : ""}</p>
        <p>{client.contactName} · {client.contactEmail}</p>
        <p>{client.timezone}</p>
        <p>Plan: {plan?.name ?? "—"}</p>
        <p className="mt-3 whitespace-pre-wrap">Hours: {knowledge?.hours ? String(knowledge.hours) : "—"}</p>
        <p className="whitespace-pre-wrap">Services: {knowledge?.services ? String(knowledge.services) : "—"}</p>
        <p className="whitespace-pre-wrap">Policies: {knowledge?.policies ? String(knowledge.policies) : "—"}</p>
        <p className="whitespace-pre-wrap">Notices: {knowledge?.notices ? String(knowledge.notices) : "—"}</p>
        <p className="whitespace-pre-wrap">Staff: {knowledge?.staff ? String(knowledge.staff) : "—"}</p>
      </section>

      {owner && client.wizardSubmittedAt ? (
        <section className="rounded-xl border border-[var(--line)] p-4">
          <h2 className="mb-1 font-medium">Edit</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Each step saves to your business{client.retellAgentId ? " and Ava updates within about a minute" : ""}. Steps marked with a dot change what Ava says.
          </p>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {WIZARD_STEP_TITLES.slice(0, 10).map((title, index) => {
              const step = index + 1;
              const blocked = OWNER_BLOCKED_STEPS.has(step);
              return (
                <li key={title} className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-1.5">
                  <span>
                    {step}. {title}
                    {AGENT_AFFECTING_STEPS.has(step) ? <span aria-label="updates Ava" className="ml-1 text-[var(--muted)]">·</span> : null}
                  </span>
                  {blocked ? (
                    <span className="text-xs text-[var(--muted)]" title={OWNER_BLOCKED_STEP_HINT}>Email support</span>
                  ) : (
                    <Link className="text-xs underline" href={`/home/business/edit/${step}`}>Edit</Link>
                  )}
                </li>
              );
            })}
          </ol>
          {OWNER_BLOCKED_STEPS.size > 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">Plan and Compliance: {OWNER_BLOCKED_STEP_HINT}</p>
          ) : null}
        </section>
      ) : null}

      {owner && client.wizardSubmittedAt ? (
        <section className="rounded-xl border border-[var(--line)] p-4">
          <CallRetentionForm days={client.callRetentionDays} />
        </section>
      ) : null}

      {owner && client.wizardSubmittedAt ? (
        <QuickUpdateForms
          hours={typeof knowledge?.hours === "string" ? knowledge.hours : ""}
          staff={typeof knowledge?.staff === "string" ? knowledge.staff : ""}
          faqs={faqs}
          targets={formatTransferTargets(targets)}
        />
      ) : null}
    </main>
  );
}
