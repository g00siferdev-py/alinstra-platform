import { ChangeEmailForm } from "@/components/change-email-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function AccountPage() {
  const session = await requireUser();
  return (
    <main className="grid max-w-lg gap-6">
      <PageHeader title="Account" />
      <Card>
        <p className="mb-1 text-sm text-[var(--muted)]">Login email</p>
        <p className="mb-4 text-sm">{session.user.email}</p>
        <ChangeEmailForm currentEmail={session.user.email} />
      </Card>
      {session.user.role === "admin" ? (
        <p className="text-sm text-[var(--muted)]">
          Admin tools still require an authenticator. <Link href="/account/security">Two-factor settings</Link>
        </p>
      ) : null}
    </main>
  );
}
