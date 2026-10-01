import { AcceptInviteForm } from "@/components/accept-invite-form";
import { Card } from "@/components/ui";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Accept your invite</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">
          You will join the client this invite was issued for. That cannot be changed here.
        </p>
        <AcceptInviteForm token={token} />
      </Card>
    </main>
  );
}
