import { CreateClientForm, InviteOwnerForm, InviteStaffForm, SignOutButton } from "@/components/home-forms";
import { clients } from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function HomePage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";
  const needsTwoFactor = isAdmin && !session.user.twoFactorEnabled;
  const clientRows = isAdmin && !needsTwoFactor ? await clients({ role: "admin" }).list() : [];

  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alinstra</h1>
          <p className="text-sm text-[var(--muted)]">
            {session.user.email} · {session.user.role}
          </p>
        </div>
        <SignOutButton />
      </header>

      {needsTwoFactor ? (
        <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="mb-2 text-lg font-medium">Two-factor authentication is required</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">Admin tools stay unavailable until an authenticator app is enrolled.</p>
          <Link className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)]" href="/account/security">
            Set up two-factor
          </Link>
        </section>
      ) : null}

      {isAdmin && !needsTwoFactor ? (
        <section className="grid gap-6 rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 md:grid-cols-2">
          <CreateClientForm />
          <InviteOwnerForm clients={clientRows.map((client) => ({ id: client.id, name: client.name }))} />
        </section>
      ) : null}

      {session.user.role === "client_owner" ? (
        <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6">
          <InviteStaffForm />
        </section>
      ) : null}

      {!isAdmin ? (
        <p className="text-sm text-[var(--muted)]">Client portal screens arrive in Phase 1. This account is scoped to its client.</p>
      ) : null}
    </main>
  );
}
