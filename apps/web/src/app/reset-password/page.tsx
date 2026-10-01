import { ResetPasswordForm } from "@/components/reset-password-form";
import { Card } from "@/components/ui";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
        {token ? <ResetPasswordForm token={token} /> : <p className="text-sm">This reset link is missing a token.</p>}
      </Card>
    </main>
  );
}
