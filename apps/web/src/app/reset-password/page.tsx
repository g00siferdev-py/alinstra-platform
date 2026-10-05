import { ResetPasswordForm } from "@/components/reset-password-form";
import { Card, PageHeader } from "@/components/ui";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader title="Choose a new password" />
        <div className="mt-4">
          {token ? <ResetPasswordForm token={token} /> : <p className="text-sm">This reset link is missing a token.</p>}
        </div>
      </Card>
    </main>
  );
}
