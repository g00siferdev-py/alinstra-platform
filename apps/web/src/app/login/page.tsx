import { LoginForm } from "@/components/login-form";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await getSession();
  if (session) redirect("/home");
  const notice = (await searchParams).notice === "unavailable" ? "This account cannot be used." : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader title="Sign in" description="Alinstra operations platform. Accounts are invite-only." />
        <div className="mt-4">
          <LoginForm notice={notice} />
        </div>
      </Card>
    </main>
  );
}
