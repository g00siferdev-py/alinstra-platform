import { AgentConfigPanel } from "@/components/agent-config-panel";
import { diffAgentConfigs, agentConfigs, clients } from "@alinstra/db";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function AgentConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const client = await clients({ role: "admin" }).getById(id);
  if (!client) notFound();
  const versions = await agentConfigs({ role: "admin" }).list(id);
  const from = Number(query.from);
  const to = Number(query.to);
  const diff = Number.isInteger(from) && Number.isInteger(to) && from > 0 && to > 0
    ? await diffAgentConfigs({ id: session.user.id, role: "admin" }, { clientId: id, fromVersion: from, toVersion: to }).catch(() => null)
    : null;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>Back to {client.name}</Link>
      <h1 className="text-2xl font-semibold">Agent config</h1>
      <p className="text-sm text-[var(--muted)]">Versions are kept. Activate and rollback copy a version into a new active one. Nothing is provisioned.</p>
      <AgentConfigPanel
        clientId={id}
        versions={versions.map((version) => ({
          version: version.version,
          status: version.status,
          source: version.source,
          templateVersion: version.templateVersion,
          promptTruncated: version.promptTruncated,
          promptText: version.promptText,
        }))}
      />
      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="grid gap-1">
          From
          <input className="w-20 rounded-md border border-[var(--line)] px-2 py-1" name="from" defaultValue={query.from ?? ""} />
        </label>
        <label className="grid gap-1">
          To
          <input className="w-20 rounded-md border border-[var(--line)] px-2 py-1" name="to" defaultValue={query.to ?? ""} />
        </label>
        <button className="cursor-pointer rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--accent-ink)]" type="submit">Compare</button>
      </form>
      {diff ? (
        <section className="grid gap-3">
          <h2 className="font-medium">Settings</h2>
          {diff.fields.length === 0 ? <p className="text-sm">No setting changes.</p> : null}
          <ul className="grid gap-2 text-sm">
            {diff.fields.map((field) => (
              <li key={field.field}>
                <p className="font-medium">{field.field}</p>
                <p className="whitespace-pre-wrap text-[var(--danger)]">{field.before || "—"}</p>
                <p className="whitespace-pre-wrap">{field.after || "—"}</p>
              </li>
            ))}
          </ul>
          <h2 className="font-medium">Prompt</h2>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">
            {diff.lines.map((line, index) => (
              <div key={`${line.op}-${index}`}>{line.op === "add" ? "+ " : line.op === "remove" ? "- " : "  "}{line.line}</div>
            ))}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
