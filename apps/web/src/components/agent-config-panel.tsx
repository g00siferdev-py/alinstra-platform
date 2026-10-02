"use client";

import { activateAgentAction, rollbackAgentAction } from "@/app/admin/agent-actions";
import { Button, ErrorText } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgentConfigPanel({
  clientId,
  versions,
}: {
  clientId: string;
  versions: Array<{ version: number; status: string; source: string; templateVersion: string; promptTruncated: boolean; promptText: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<number | null>(versions[0]?.version ?? null);
  const current = versions.find((version) => version.version === shown) ?? versions[0];

  async function run(action: (clientId: string, version: number) => Promise<{ error?: string; ok?: boolean }>, version: number) {
    setPending(true);
    setError(null);
    const result = await action(clientId, version);
    setPending(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="grid gap-4">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ul className="grid gap-2">
        {versions.map((version) => (
          <li key={version.version} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--line)] p-3 text-sm">
            <button className="cursor-pointer font-medium" type="button" onClick={() => setShown(version.version)}>
              v{version.version}
            </button>
            <span>{version.status}</span>
            <span className="text-[var(--muted)]">{version.source} · template {version.templateVersion}{version.promptTruncated ? " · truncated" : ""}</span>
            {version.status === "draft" ? (
              <Button disabled={pending} onClick={() => void run(activateAgentAction, version.version)}>Activate</Button>
            ) : null}
            {version.status !== "active" ? (
              <Button disabled={pending} onClick={() => void run(rollbackAgentAction, version.version)}>Rollback</Button>
            ) : null}
          </li>
        ))}
      </ul>
      {current ? (
        <section>
          <h2 className="mb-2 font-medium">Preview v{current.version}</h2>
          {current.promptTruncated ? <p className="mb-2 text-sm">Some reference material was cut to fit the prompt size limit.</p> : null}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line)] p-3 text-xs">{current.promptText}</pre>
        </section>
      ) : <p className="text-sm">No receptionist config yet.</p>}
    </div>
  );
}
