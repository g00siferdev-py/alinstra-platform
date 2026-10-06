import { OwnerSetupReview } from "@/components/owner-setup-review";
import { PageHeader } from "@/components/ui";
import { formPayload } from "@/lib/wizard-form-payload";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import {
  clients,
  emptyWizardPayload,
  plans,
  wizardDrafts,
  wizardPayloadSchema,
} from "@alinstra/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export default async function OwnerSetupPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();
  const ctx = { role: "client_owner" as const, clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client) notFound();
  if (client.wizardSubmittedAt) redirect("/home/business");

  const [draft, planRows] = await Promise.all([
    wizardDrafts(ctx).getByClientId(client.id),
    plans(ctx).list(),
  ]);
  if (!draft) notFound();
  const parsed = wizardPayloadSchema.safeParse(draft.payload);
  const payload = parsed.success ? parsed.data : emptyWizardPayload();

  return (
    <main className="mx-auto grid max-w-2xl gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Review and submit"
        description="Check what the interview captured, then send it to our team for review."
      />
      <OwnerSetupReview
        clientId={client.id}
        emailVerified={Boolean(session.user.emailVerified)}
        initialUpdatedAt={draft.updatedAt.toISOString()}
        initialPayload={formPayload(payload, client.internal)}
        plans={planRows.map((plan) => ({
          id: plan.id,
          name: plan.name,
          monthlyPriceCents: plan.monthlyPriceCents,
        }))}
      />
    </main>
  );
}
