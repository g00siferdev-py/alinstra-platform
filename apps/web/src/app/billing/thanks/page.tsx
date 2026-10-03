import { Card } from "@/components/ui";

export default function BillingThanksPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <p className="text-sm font-medium text-[var(--muted)]">Alinstra</p>
        <h1 className="mt-1 text-xl font-semibold">Payment received</h1>
        <p className="mt-3 text-sm">Thank you! Alinstra will finish setting up your receptionist and email you when it's live.</p>
      </Card>
    </main>
  );
}
