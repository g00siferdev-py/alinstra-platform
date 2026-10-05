import { InterviewSettingsForm } from "@/components/interview-settings-form";
import { Card, EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { getEnv } from "@alinstra/config";
import {
  INTERVIEW_SYSTEM_PROMPT,
  listInterviewSessions,
  listLoadedBanks,
  resolveTextInterviewConfig,
} from "@alinstra/db";
import Link from "next/link";

export default async function AdminInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const session = await requireAdmin();
  const query = await searchParams;
  const focusId = Array.isArray(query.session) ? query.session[0] : query.session;
  const config = await resolveTextInterviewConfig(getEnv());
  const banks = listLoadedBanks();
  const sessions = await listInterviewSessions({ id: session.user.id, role: "admin" }, 40);
  const sessionRows = sessions.map((row) => {
    const state = row.state as {
      transcript?: Array<{ role: string; content: string }>;
      turnLog?: Array<{
        finishReason: string | null;
        parseOk: boolean;
        droppedPaths: string[];
        model: string;
        tokensIn: number;
        tokensOut: number;
      }>;
    };
    return {
      id: row.id,
      industry: row.industry,
      status: row.status,
      model: row.model,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      clientName: row.client?.name ?? "—",
      startedAt: row.createdAt.toISOString().slice(0, 16),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString().slice(0, 16) : "—",
      transcript: focusId === row.id ? (state.transcript ?? []) : [],
      turnLog: focusId === row.id ? (state.turnLog ?? []) : [],
    };
  });
  const focused = focusId ? sessionRows.find((row) => row.id === focusId) : null;

  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Interview settings"
        description={
          <>
            Env values are defaults. Saved settings override base URL, model, fallback, and budgets. The API key stays in
            environment only.
            {config.enabled ? "" : " Interview is currently disabled (TEXT_API_KEY is empty)."}
          </>
        }
      />

      <InterviewSettingsForm
        defaults={{
          textApiBase: config.apiBase,
          textModel: config.model,
          textFallbackModel: config.fallbackModel,
          budgetInputTokens: config.budgetInputTokens,
          budgetOutputTokens: config.budgetOutputTokens,
          reasoningEffort: config.reasoningEffort,
        }}
      />

      <Card className="grid gap-3">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Active system prompt</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-xs">
          {INTERVIEW_SYSTEM_PROMPT}
        </pre>
      </Card>

      <SectionCard title="Question banks">
        {banks.map((bank) => (
          <div key={bank.industry} className="px-5 py-4 text-sm">
            <span className="font-bold text-[var(--ink)]">{bank.industry}</span>
            {" — "}
            {bank.itemCount} items
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Sessions">
        {sessionRows.length === 0 ? (
          <EmptyState title="No interviews yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--divider)] text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-5 py-3 font-semibold">Industry</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Model</th>
                  <th className="px-5 py-3 font-semibold">Tokens</th>
                  <th className="px-5 py-3 font-semibold">Started</th>
                  <th className="px-5 py-3 font-semibold">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--divider)]">
                {sessionRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <Link className="font-semibold" href={`/admin/interview?session=${row.id}`}>
                        {row.clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{row.industry}</td>
                    <td className="px-5 py-3">{row.status}</td>
                    <td className="px-5 py-3">{row.model}</td>
                    <td className="px-5 py-3">
                      {row.tokensIn}/{row.tokensOut}
                    </td>
                    <td className="px-5 py-3">{row.startedAt}</td>
                    <td className="px-5 py-3">{row.finishedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {focused ? (
          <div className="grid gap-2 border-t border-[var(--divider)] px-5 py-4">
            <h3 className="font-extrabold text-[var(--ink)]">Transcript · {focused.clientName}</h3>
            {focused.transcript.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Empty transcript.</p>
            ) : (
              focused.transcript.map((turn, index) => {
                const assistantOrdinal =
                  focused.transcript.slice(0, index + 1).filter((row) => row.role === "assistant").length - 1;
                // Greeting is assistant #0 with no turnLog; model turns start at assistant #1 → turnLog[0].
                const diag =
                  turn.role === "assistant" && assistantOrdinal > 0
                    ? focused.turnLog[assistantOrdinal - 1]
                    : null;
                return (
                  <div key={`${turn.role}-${index}`} className="text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{turn.role}</p>
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                    {diag ? (
                      <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                        parseOk={String(diag.parseOk)} finish={diag.finishReason ?? "—"} model={diag.model}{" "}
                        tokens={diag.tokensIn}/{diag.tokensOut}
                        {diag.droppedPaths.length > 0 ? ` dropped=[${diag.droppedPaths.join(", ")}]` : ""}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </SectionCard>
    </main>
  );
}
