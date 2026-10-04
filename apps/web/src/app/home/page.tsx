import { changeRequests, clientMessages, clients, formatLocalTime, plans, quickUpdates, type TenantContext } from "@alinstra/db";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function HomePage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";
  const needsTwoFactor = isAdmin && !session.user.twoFactorEnabled;
  const role = session.user.role;
  const clientId = session.user.clientId;
  let messages: Array<{ id: string; callerName: string; body: string; createdAt: Date }> = [];
  let clientName: string | null = null;
  let clientTimezone = "America/New_York";
  let planName: string | null = null;
  let minutes = 0;
  let heldUpdates: Array<{ id: string; clientId: string; kind: string }> = [];
  let pendingRequests: Array<{ id: string; clientId: string; category: string }> = [];
  if (clientId && (role === "client_owner" || role === "client_staff")) {
    const ctx: TenantContext = { role, clientId };
    const [client, messageRows] = await Promise.all([
      clients(ctx).getById(clientId),
      clientMessages(ctx).list(clientId),
    ]);
    messages = messageRows;
    const plan = client?.planId ? await plans(ctx).getById(client.planId) : null;
    clientName = client?.name ?? null;
    clientTimezone = client?.timezone ?? clientTimezone;
    planName = plan?.name ?? null;
    minutes = client?.overrideIncludedMinutes ?? plan?.includedMinutes ?? 0;
  }
  if (isAdmin && !needsTwoFactor) {
    const [held, pending] = await Promise.all([
      quickUpdates({ role: "admin" }).listHeld(),
      changeRequests({ role: "admin" }).listPending(),
    ]);
    heldUpdates = held.map((row) => ({ id: row.id, clientId: row.clientId, kind: row.kind }));
    pendingRequests = pending.map((row) => ({ id: row.id, clientId: row.clientId, category: row.category }));
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-6">
      <h1 className="text-2xl font-semibold">Home</h1>

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
        <section className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 text-sm">
          <h2 className="text-lg font-medium">Waiting on review</h2>
          {pendingRequests.length === 0 && heldUpdates.length === 0 ? <p className="text-[var(--muted)]">No pending requests or held updates.</p> : null}
          <ul className="grid gap-1">
            {pendingRequests.map((request) => (
              <li key={request.id}>
                <Link href={`/admin/clients/${request.clientId}/changes`}>Change request · {request.category}</Link>
              </li>
            ))}
            {heldUpdates.map((update) => (
              <li key={update.id}>
                <Link href={`/admin/clients/${update.clientId}/changes`}>Held quick update · {update.kind}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {clientName ? (
        <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-lg font-medium">{clientName}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{planName ?? "No plan yet"}</p>
          <p className="mt-3 text-sm">Minutes included: {minutes}</p>
          <p className="text-sm">Calls today: 0 · not connected yet</p>
          <p className="text-sm">Appointments: 0 · not connected yet</p>
          <div className="mt-3 text-sm">
            <p className="font-medium">Messages</p>
            {messages.length === 0 ? <p className="text-[var(--muted)]">No messages yet.</p> : null}
            <ul className="grid gap-1">
              {messages.map((message) => (
                <li key={message.id}>{formatLocalTime(message.createdAt, clientTimezone)} · {message.callerName}: {message.body}</li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/home/business">My business</Link>
            {session.user.role === "client_owner" ? <Link href="/home/changes">Change requests</Link> : null}
            {session.user.role === "client_owner" ? <Link href="/home/team">Team</Link> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
