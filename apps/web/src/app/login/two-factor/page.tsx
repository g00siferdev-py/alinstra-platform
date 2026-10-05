import { TwoFactorForm } from "@/components/two-factor-form";
import { Card, PageHeader } from "@/components/ui";

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader title="Two-factor check" description="Enter the code from your authenticator app." />
        <div className="mt-4">
          <TwoFactorForm />
        </div>
      </Card>
    </main>
  );
}
