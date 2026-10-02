import { QuickUpdateForms } from "@/components/quick-update-forms";
import { clients, faqItems, knowledgeBases, plans } from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function MyBusinessPage() {
  const session = await requireUser();
  if (session.user.role === "admin" || !session.user.clientId) notFound();
  const ctx = { role: session.user.role as "client_owner" | "client_staff", clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client) notFound();
  const [plan, knowledge] = await Promise.all([
    client.planId ? plans(ctx).getById(client.planId) : Promise.resolve(null),
    knowledgeBases(ctx).getCurrent(session.user.clientId),
  ]);
  const owner = session.user.role === "client_owner";
  const faqs = faqItems(knowledge?.faqs);
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">Home</Link>
      <h1 className="text-2xl font-semibold">My business</h1>
      <p className="text-sm text-[var(--muted)]">
        {owner
          ? "Hours, notices, staff, and one FAQ at a time can be updated here. Other changes go through a request."
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
        <QuickUpdateForms
          hours={typeof knowledge?.hours === "string" ? knowledge.hours : ""}
          staff={typeof knowledge?.staff === "string" ? knowledge.staff : ""}
          faqs={faqs}
        />
      ) : null}
    </main>
  );
}
