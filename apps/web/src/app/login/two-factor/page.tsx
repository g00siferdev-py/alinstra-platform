import { TwoFactorForm } from "@/components/two-factor-form";
import { Card } from "@/components/ui";

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Two-factor check</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">Enter the code from your authenticator app.</p>
        <TwoFactorForm />
      </Card>
    </main>
  );
}
