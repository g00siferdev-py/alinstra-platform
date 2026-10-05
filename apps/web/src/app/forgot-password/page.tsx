import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { Card, PageHeader } from "@/components/ui";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader title="Reset your password" />
        <div className="mt-4">
          <ForgotPasswordForm />
        </div>
      </Card>
    </main>
  );
}
