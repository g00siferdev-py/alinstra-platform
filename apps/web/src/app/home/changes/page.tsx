import { ChangeRequestForm } from "@/components/change-request-form";
import { PageHeader } from "@/components/ui";
import { changeAllowance, changeRequests } from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ChangeRequestsPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  const actor = { id: session.user.id, role: "client_owner" as const, clientId: session.user.clientId };
  const [allowance, requests] = await Promise.all([
    changeAllowance(actor, session.user.clientId),
    changeRequests(actor).list(session.user.clientId),
  ]);
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Change requests"
        description="These are reviewed by Alinstra. Rejected and cancelled requests do not use the monthly allowance."
      />
      <ChangeRequestForm
        unlimited={allowance.unlimited}
        remaining={allowance.remaining}
        feeCents={allowance.feeCents}
        over={allowance.over}
        requests={requests.map((request) => ({
          id: request.id,
          category: request.category,
          description: request.description,
          status: request.status,
          feeCents: request.feeCents,
        }))}
      />
    </main>
  );
}
