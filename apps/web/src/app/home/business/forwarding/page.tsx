import { CopyButton } from "@/components/copy-button";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { clients, formatPhone, needsOwnNumberForwarding } from "@alinstra/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ForwardingPage() {
  const session = await requireUser();
  if (session.user.role === "admin" || !session.user.clientId) notFound();
  const ctx = { role: session.user.role as "client_owner" | "client_staff", clientId: session.user.clientId };
  const client = await clients(ctx).getById(session.user.clientId);
  if (!client) notFound();
  if (!needsOwnNumberForwarding(client.phone)) notFound();

  const alinstra = client.phoneE164?.trim() ?? "";
  const display = alinstra ? formatPhone(alinstra) || alinstra : "";
  const dial = alinstra.replace(/^\+1/, "").replace(/\D/g, "");

  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home/business">
        My business
      </Link>
      <PageHeader
        title="Forward your number"
        description={
          <>
            You keep your existing business number. Set <strong className="font-semibold text-[var(--ink)]">conditional call forwarding</strong> (no answer and busy) to the Alinstra number below so Ava takes the calls you miss. Do not use unconditional forwarding.
          </>
        }
      />
      <p className="text-sm text-[var(--muted)]">
        Nothing in this app sets up forwarding for you — you (or your carrier) do it on your line. Confirm the exact codes with your carrier; some business lines have forwarding disabled by default.
      </p>

      <Card>
        <p className="text-sm text-[var(--muted)]">Forward missed calls to</p>
        {display ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">{display}</p>
            <CopyButton value={alinstra} label="number" />
          </div>
        ) : (
          <p className="mt-2 text-sm">Your Alinstra number is not ready yet. Check back after provisioning finishes.</p>
        )}
      </Card>

      <Card className="text-sm">
        <h2 className="mb-2 text-base font-extrabold text-[var(--ink)]">Carrier codes</h2>
        <ul className="grid gap-2">
          <li>
            <strong className="font-semibold">AT&amp;T (landline and wireless):</strong> dial{" "}
            <code>*92</code> then the Alinstra number for no answer; <code>*90</code> then the number for busy. Cancel with{" "}
            <code>*93</code> / <code>*91</code>.
          </li>
          <li>
            <strong className="font-semibold">Verizon:</strong> dial <code>*71</code> then the Alinstra number for no-answer and busy
            forwarding. Cancel with <code>*73</code>.
          </li>
          <li>
            <strong className="font-semibold">T-Mobile:</strong> dial <code>**61*1{dial || "<alinstra number>"}#</code> for no answer
            and <code>**67*1{dial || "<alinstra number>"}#</code> for busy. Cancel with <code>##61#</code> / <code>##67#</code>.
          </li>
          <li>
            <strong className="font-semibold">Landline and VoIP (Comcast, Spectrum, RingCentral, Ooma, and others):</strong> codes
            vary; most expose &quot;Forward when unanswered&quot; and &quot;Forward when busy&quot; in the account portal. Set both to the
            Alinstra number and pick 3–4 rings before forwarding.
          </li>
        </ul>
      </Card>

      <Card className="text-sm">
        <h2 className="mb-2 text-base font-extrabold text-[var(--ink)]">Test it</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>From a cell phone, call your usual business number (not the Alinstra number).</li>
          <li>Let it ring out — do not answer.</li>
          <li>Ava should answer with your greeting.</li>
          <li>
            Confirm the call appears on{" "}
            <Link className="font-semibold" href="/home/calls">
              Calls
            </Link>
            .
          </li>
        </ol>
      </Card>
    </main>
  );
}
