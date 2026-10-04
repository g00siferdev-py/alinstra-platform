import { MarkContactedButton } from "@/components/marketing/mark-contacted-button";
import { formatLocalTime, leadIndustryLabel, leadIndustryToWizard, leadMissedCallsLabel, listLeads } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage() {
  await requireAdmin();
  const leads = await listLeads({ role: "admin" });

  return (
    <main className="mx-auto grid max-w-4xl gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-[var(--muted)]">Newest first from the marketing start form.</p>
        </div>
        <Link className="text-sm underline" href="/admin/clients/new">
          Create client
        </Link>
      </div>
      {leads.length === 0 ? <p className="text-sm text-[var(--muted)]">No leads yet.</p> : null}
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
            <li key={lead.id} className="rounded-xl border border-[var(--line)] p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <p className="font-medium text-[var(--ink)]">{lead.business}</p>
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
                  <Link className="underline" href={`/admin/clients/new?${params.toString()}`}>
                    Create client
                  </Link>
                  {lead.convertedClientId ? (
                    <Link className="underline" href={`/admin/clients/${lead.convertedClientId}`}>
                      Open client
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
