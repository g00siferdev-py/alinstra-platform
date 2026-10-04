import { CallAccessToggle } from "@/components/call-access-toggle";
import { InviteStaffForm } from "@/components/home-forms";
import { requireUser } from "@/lib/session";
import { users } from "@alinstra/db";
import { notFound } from "next/navigation";

export default async function TeamPage() {
  const session = await requireUser();
  if (session.user.role !== "client_owner" || !session.user.clientId) notFound();
  const people = await users({ role: "client_owner", clientId: session.user.clientId }).list();
  const staff = people.filter((person) => person.role === "client_staff");
  return (
    <main className="mx-auto grid max-w-lg gap-6 p-6">
      <h1 className="text-2xl font-semibold">Team</h1>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-1 font-medium">Staff</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Staff see the Calls page, transcripts, and recordings only when you turn on call access. Caller numbers stay masked for staff. Each change is recorded in your change log.
        </p>
        {staff.length === 0 ? <p className="text-sm text-[var(--muted)]">No staff accounts yet.</p> : null}
        <ul className="grid gap-3">
          {staff.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-2">
              <div className="text-sm">
                <div>{person.name || person.email}</div>
                <div className="text-[var(--muted)]">{person.email}</div>
              </div>
              <CallAccessToggle userId={person.id} email={person.email} canViewCalls={person.canViewCalls} />
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="mb-3 font-medium">Invite staff</h2>
        <InviteStaffForm />
      </section>
    </main>
  );
}
