import { InviteStaffForm } from "@/components/home-forms";
import { requireUser } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function TeamPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner") notFound();
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-6">
      <h1 className="text-2xl font-semibold">Team</h1>
      <InviteStaffForm />
    </main>
  );
}
