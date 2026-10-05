import { AgentConfigPanel } from "@/components/agent-config-panel";
import { Button, Card, Input, Label, PageHeader } from "@/components/ui";
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
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href={`/admin/clients/${id}`}>
        Back to {client.name}
      </Link>
      <PageHeader
        title="Agent config"
        description="Versions are kept. Activate and rollback copy a version into a new active one. Nothing is provisioned."
      />
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
      <Card>
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
          <div>
            <Label htmlFor="from">From</Label>
            <Input className="w-20" id="from" name="from" defaultValue={query.from ?? ""} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input className="w-20" id="to" name="to" defaultValue={query.to ?? ""} />
          </div>
          <Button variant="secondary" type="submit">
            Compare
          </Button>
        </form>
      </Card>
      {diff ? (
        <Card className="grid gap-3">
          <h2 className="text-base font-extrabold text-[var(--ink)]">Settings</h2>
          {diff.fields.length === 0 ? <p className="text-sm">No setting changes.</p> : null}
          <ul className="grid gap-2 text-sm">
            {diff.fields.map((field) => (
              <li key={field.field}>
                <p className="font-semibold">{field.field}</p>
                <p className="whitespace-pre-wrap text-[var(--danger-text)]">{field.before || "—"}</p>
                <p className="whitespace-pre-wrap">{field.after || "—"}</p>
              </li>
            ))}
          </ul>
          <h2 className="text-base font-extrabold text-[var(--ink)]">Prompt</h2>
          <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-xs">
            {diff.lines.map((line, index) => (
              <div key={`${line.op}-${index}`}>{line.op === "add" ? "+ " : line.op === "remove" ? "- " : "  "}{line.line}</div>
            ))}
          </pre>
        </Card>
      ) : null}
    </main>
  );
}
