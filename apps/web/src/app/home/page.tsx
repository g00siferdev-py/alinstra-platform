import { SignOutButton } from "@/components/home-forms";
import { clients, plans, type TenantContext } from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function HomePage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";
  const needsTwoFactor = isAdmin && !session.user.twoFactorEnabled;
  const role = session.user.role;
  const clientId = session.user.clientId;
  let clientName: string | null = null;
  let planName: string | null = null;
  let minutes = 0;
  if (clientId && (role === "client_owner" || role === "client_staff")) {
    const ctx: TenantContext = { role, clientId };
    const client = await clients(ctx).getById(clientId);
    const plan = client?.planId ? await plans(ctx).getById(client.planId) : null;
    clientName = client?.name ?? null;
    planName = plan?.name ?? null;
    minutes = client?.overrideIncludedMinutes ?? plan?.includedMinutes ?? 0;
  }

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
        <section className="flex flex-wrap gap-3">
          <Link className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)]" href="/admin/clients">
            Clients
          </Link>
          <Link className="rounded-md border border-[var(--line)] px-4 py-2 text-sm" href="/admin/plans">
            Plans
          </Link>
        </section>
      ) : null}

      {clientName ? (
        <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-lg font-medium">{clientName}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{planName ?? "No plan yet"}</p>
          <p className="mt-3 text-sm">Minutes included: {minutes}</p>
          <p className="text-sm">Calls today: 0 · not connected yet</p>
          <p className="text-sm">Appointments: 0 · not connected yet</p>
          <p className="text-sm">Messages: 0 · not connected yet</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/home/business">My business</Link>
            {session.user.role === "client_owner" ? <Link href="/home/team">Team</Link> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
