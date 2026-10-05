import { Card, PageHeader } from "@/components/ui";

export default function BillingCanceledPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <p className="text-[13px] font-semibold text-[var(--muted)]">Alinstra</p>
        <PageHeader
          title="Payment canceled"
          description="No charge was made. Contact Alinstra and we will send a new payment link."
        />
      </Card>
    </main>
  );
}
