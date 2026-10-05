import { Card, PageHeader } from "@/components/ui";

export default function BillingThanksPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <p className="text-[13px] font-semibold text-[var(--muted)]">Alinstra</p>
        <PageHeader
          title="Payment received"
          description="Thank you! Alinstra will finish setting up your receptionist and email you when it's live."
        />
      </Card>
    </main>
  );
}
