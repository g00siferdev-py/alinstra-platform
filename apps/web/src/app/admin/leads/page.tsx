import { MarkContactedButton } from "@/components/marketing/mark-contacted-button";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatLocalTime, leadIndustryLabel, leadIndustryToWizard, leadMissedCallsLabel, listLeads } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage() {
  await requireAdmin();
  const leads = await listLeads({ role: "admin" });

  return (
    <main className="grid gap-6">
      <PageHeader
        title="Leads"
        description="Newest first from the marketing start form."
        actions={
          <Link href="/admin/clients/new">
            <Button variant="secondary">Create client</Button>
          </Link>
        }
      />
      {leads.length === 0 ? (
        <Card>
          <EmptyState title="No leads yet" />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {leads.map((lead) => {
            const params = new URLSearchParams({
              business: lead.business,
              contactName: lead.name,
              contactPhone: lead.phone,
              contactEmail: lead.email,
              industry: leadIndustryToWizard(lead.industry),
              leadId: lead.id,
            });
            return (
              <li key={lead.id}>
                <Card className="text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <p className="font-bold text-[var(--ink)]">{lead.business}</p>
                      <p>
                        {lead.name} · {lead.phone} · {lead.email}
                      </p>
                      <p className="text-[var(--muted)]">
                        {leadIndustryLabel(lead.industry)} · misses {leadMissedCallsLabel(lead.missedCalls)} / week
                      </p>
                      {lead.notes ? <p className="whitespace-pre-wrap">{lead.notes}</p> : null}
                      <p className="text-[var(--muted)]">{formatLocalTime(lead.createdAt, "America/New_York")}</p>
                      {lead.contactedAt ? (
                        <p className="text-[var(--muted)]">Contacted {formatLocalTime(lead.contactedAt, "America/New_York")}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {!lead.contactedAt ? <MarkContactedButton id={lead.id} /> : null}
                      <Link className="text-sm font-semibold" href={`/admin/clients/new?${params.toString()}`}>
                        Create client
                      </Link>
                      {lead.convertedClientId ? (
                        <Link className="text-sm font-semibold" href={`/admin/clients/${lead.convertedClientId}`}>
                          Open client
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
