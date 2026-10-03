import { Card } from "@/components/ui";

export default function BillingCanceledPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <p className="text-sm font-medium text-[var(--muted)]">Alinstra</p>
        <h1 className="mt-1 text-xl font-semibold">Payment canceled</h1>
        <p className="mt-3 text-sm">No charge was made. Contact Alinstra and we will send a new payment link.</p>
      </Card>
    </main>
  );
}
