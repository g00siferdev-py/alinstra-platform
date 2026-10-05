import { InterviewSettingsForm } from "@/components/interview-settings-form";
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
  const focused = focusId ? sessions.find((row) => row.id === focusId) : null;
  const transcript = focused
    ? ((focused.state as { transcript?: Array<{ role: string; content: string }> }).transcript ?? [])
    : [];

  return (
    <main className="mx-auto grid max-w-4xl gap-8 p-6">
      <div>
        <Link className="text-sm text-[var(--muted)]" href="/home">
          Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Interview settings</h1>
        <p className="text-sm text-[var(--muted)]">
          Env values are defaults. Saved settings override base URL, model, fallback, and budgets. The API key stays in
          environment only.
          {config.enabled ? "" : " Interview is currently disabled (TEXT_API_KEY is empty)."}
        </p>
      </div>

      <InterviewSettingsForm
        defaults={{
          textApiBase: config.apiBase,
          textModel: config.model,
          textFallbackModel: config.fallbackModel,
          budgetInputTokens: config.budgetInputTokens,
          budgetOutputTokens: config.budgetOutputTokens,
        }}
      />

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Active system prompt</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] p-4 text-xs">
          {INTERVIEW_SYSTEM_PROMPT}
        </pre>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Question banks</h2>
        <ul className="grid gap-2 text-sm">
          {banks.map((bank) => (
            <li key={bank.industry} className="rounded-xl border border-[var(--line)] px-4 py-3">
              <span className="font-medium">{bank.industry}</span>
              {" — "}
              {bank.itemCount} items
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Sessions</h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--line)] text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Industry</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Finished</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-[var(--muted)]" colSpan={7}>
                    No interviews yet.
                  </td>
                </tr>
              ) : (
                sessions.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--line)]">
                    <td className="px-3 py-2">
                      <Link className="underline" href={`/admin/interview?session=${row.id}`}>
                        {row.client?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.industry}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.model}</td>
                    <td className="px-3 py-2">
                      {row.tokensIn}/{row.tokensOut}
                    </td>
                    <td className="px-3 py-2">{row.createdAt.toISOString().slice(0, 16)}</td>
                    <td className="px-3 py-2">{row.finishedAt ? row.finishedAt.toISOString().slice(0, 16) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {focused ? (
          <div className="grid gap-2 rounded-xl border border-[var(--line)] p-4">
            <h3 className="font-medium">Transcript · {focused.client?.name ?? focused.id}</h3>
            {transcript.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Empty transcript.</p>
            ) : (
              transcript.map((turn, index) => (
                <div key={`${turn.role}-${index}`} className="text-sm">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{turn.role}</p>
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
