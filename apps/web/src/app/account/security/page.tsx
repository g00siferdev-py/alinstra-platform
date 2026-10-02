import { ReenrollForm, SecurityForm } from "@/components/security-form";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SecurityPage() {
  const session = await requireUser();
  if (session.user.role !== "admin") redirect("/home");
  if (session.user.twoFactorEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card>
          <h1 className="mb-1 text-xl font-semibold">Replace authenticator</h1>
          <p className="mb-4 text-sm text-[var(--muted)]">Enter a current code. Two-factor stays on while the new authenticator is enrolled.</p>
          <ReenrollForm />
        </Card>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Set up two-factor authentication</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">Admin access stays locked until this is finished.</p>
        <SecurityForm />
      </Card>
    </main>
  );
}
