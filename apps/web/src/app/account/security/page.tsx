import { ReenrollForm, SecurityForm } from "@/components/security-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SecurityPage() {
  const session = await requireUser();
  if (session.user.role !== "admin") redirect("/home");
  if (session.user.twoFactorEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <PageHeader
            title="Replace authenticator"
            description="Enter a current code. Two-factor stays on while the new authenticator is enrolled."
          />
          <div className="mt-4">
            <ReenrollForm />
          </div>
        </Card>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader title="Set up two-factor authentication" description="Admin access stays locked until this is finished." />
        <div className="mt-4">
          <SecurityForm />
        </div>
      </Card>
    </main>
  );
}
