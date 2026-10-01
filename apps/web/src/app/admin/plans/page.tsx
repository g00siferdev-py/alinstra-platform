import { PlanEditor } from "@/components/plan-editor";
import { plans } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";

export default async function PlansPage() {
  await requireAdmin();
  const rows = await plans({ role: "admin" }).list();
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">Home</Link>
      <h1 className="text-2xl font-semibold">Plans</h1>
      {rows.map((plan) => (
        <PlanEditor key={plan.id} plan={plan} />
      ))}
    </main>
  );
}
