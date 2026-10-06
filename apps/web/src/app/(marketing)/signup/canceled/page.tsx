import { ReopenCheckoutButton } from "@/components/reopen-checkout-button";
import { Card, PageHeader } from "@/components/ui";
import { marketingMetadata } from "@/lib/marketing-seo";
import { requireUser } from "@/lib/session";
import { clients } from "@alinstra/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = marketingMetadata({
  title: "Checkout canceled",
  description: "Your account is saved. Finish checkout anytime.",
  path: "/signup/canceled",
});

export default async function SignupCanceledPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) {
    redirect("/home");
  }
  const client = await clients({
    role: "client_owner",
    clientId: session.user.clientId,
  }).getById(session.user.clientId);
  if (!client || client.billingStatus === "paid") {
    redirect("/home");
  }

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-7 py-16">
      <PageHeader title="Checkout canceled" />
      <Card className="grid gap-4">
        <p className="text-[var(--body)]">Your account is saved; finish checkout anytime.</p>
        <ReopenCheckoutButton />
        <Link className="text-sm font-semibold text-[var(--muted)]" href="/home">
          Back to home
        </Link>
      </Card>
    </main>
  );
}
