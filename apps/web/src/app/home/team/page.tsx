import { CallAccessToggle } from "@/components/call-access-toggle";
import { InviteStaffForm } from "@/components/home-forms";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { redirectUnpaidSelfServeOwner } from "@/lib/self-serve-gate";
import { users } from "@alinstra/db";
import { notFound } from "next/navigation";

export default async function TeamPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  await redirectUnpaidSelfServeOwner();
  const people = await users({ role: "client_owner", clientId: session.user.clientId }).list();
  const staff = people.filter((person) => person.role === "client_staff");
  return (
    <main className="grid max-w-lg gap-6">
      <PageHeader title="Team" />
      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Staff</h2>
        <p className="text-sm text-[var(--muted)]">
          Staff see the Calls page, transcripts, and recordings only when you turn on call access. Caller numbers stay masked for staff. Each change is recorded in your change log.
        </p>
        {staff.length === 0 ? <EmptyState title="No staff accounts yet" /> : null}
        <ul className="grid gap-3">
          {staff.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2">
              <div className="text-sm">
                <div className="font-semibold">{person.name || person.email}</div>
                <div className="text-[var(--muted)]">{person.email}</div>
              </div>
              <CallAccessToggle userId={person.id} email={person.email} canViewCalls={person.canViewCalls} />
            </li>
          ))}
        </ul>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Invite staff</h2>
        <InviteStaffForm />
      </Card>
    </main>
  );
}
