import { NewClientForm } from "@/components/new-client-form";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/admin/clients">Back to clients</Link>
      <Card>
        <h1 className="mb-4 text-xl font-semibold">New client</h1>
        <NewClientForm />
      </Card>
    </main>
  );
}
