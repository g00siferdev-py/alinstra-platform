import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/home");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">Alinstra operations platform. Accounts are invite-only.</p>
        <LoginForm />
      </Card>
    </main>
  );
}
