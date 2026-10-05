import { AcceptInviteForm } from "@/components/accept-invite-form";
import { Card, PageHeader } from "@/components/ui";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <PageHeader
          title="Accept your invite"
          description="You will join the client this invite was issued for. That cannot be changed here."
        />
        <div className="mt-4">
          <AcceptInviteForm token={token} />
        </div>
      </Card>
    </main>
  );
}
