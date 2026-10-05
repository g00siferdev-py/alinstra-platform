import { NewClientForm } from "@/components/new-client-form";
import { Card } from "@/components/ui";
import { interviewEnabled } from "@/lib/interview-server";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  const defaults = {
    business: one("business"),
    contactName: one("contactName"),
    contactPhone: one("contactPhone"),
    contactEmail: one("contactEmail"),
    industry: one("industry"),
    leadId: one("leadId"),
  };
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/admin/clients">
        Back to clients
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-semibold">New client</h1>
        <NewClientForm defaults={defaults} interviewEnabled={interviewEnabled()} />
      </Card>
    </main>
  );
}
