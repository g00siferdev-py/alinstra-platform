import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { Card } from "@/components/ui";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Reset your password</h1>
        <ForgotPasswordForm />
      </Card>
    </main>
  );
}
