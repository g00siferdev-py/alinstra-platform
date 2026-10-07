/**
 * Replay Daniel's lawn-care setup answers against a live text model.
 *
 *   TEXT_API_KEY=… TEXT_MODEL=moonshotai/kimi-k2.5 TEXT_REASONING_EFFORT=off \
 *     pnpm --filter @alinstra/agent interview:replay
 *
 * Exit 1 if any item was asked more than twice or any capabilityFlag fired.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpText } from "@alinstra/providers";
import {
  initialInterviewState,
  interviewGreeting,
  interviewTurn,
  type InterviewIndustry,
  type InterviewState,
} from "../src/interview/index.js";

type Fixture = {
  industry: InterviewIndustry;
  planCode?: string | null;
  answers: string[];
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function main(): Promise<void> {
  const apiKey = env("TEXT_API_KEY");
  if (!apiKey) {
    console.error("TEXT_API_KEY is required.");
    process.exit(1);
  }

  const baseUrl = env("TEXT_API_BASE") ?? "https://openrouter.ai/api/v1";
  const model = env("TEXT_MODEL") ?? "moonshotai/kimi-k2.5";
  const reasoningRaw = env("TEXT_REASONING_EFFORT") ?? "off";
  const reasoningEffort =
    reasoningRaw === "low" || reasoningRaw === "default" || reasoningRaw === "off" ? reasoningRaw : "off";

  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(here, "fixtures", "lawn-care.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

  const text = httpText({
    apiKey,
    baseUrl,
    model,
    reasoningEffort,
    timeoutMs: 40_000,
  });

  let state: InterviewState = initialInterviewState(fixture.industry, {
    planCode: fixture.planCode ?? null,
  });
  const greeting = interviewGreeting(fixture.industry);
  state.transcript = [{ role: "assistant", content: greeting }];

  console.log(`model=${model} reasoning=${reasoningEffort} plan=${fixture.planCode ?? "null"}`);
  console.log(`Q: (greeting) ${greeting}`);
  console.log("");

  const capabilityFlags: Array<{ questionId: string | null; turn: number }> = [];

  for (let i = 0; i < fixture.answers.length; i += 1) {
    const answer = fixture.answers[i]!;
    const beforeQ = state.currentQuestionId;
    console.log(`A${i + 1}: ${answer}`);
    const result = await interviewTurn({ state, userMessage: answer, text });
    state = result.state;
    const last = state.turnLog?.[state.turnLog.length - 1];
    console.log(`Q: (${beforeQ ?? "—"}) ${result.reply}`);
    if (last?.capabilityFlag) {
      capabilityFlags.push({ questionId: last.currentQuestionId ?? beforeQ, turn: i + 1 });
      console.log("  !! capabilityFlag");
    }
    if (last?.fallback) console.log(`  fallback=${last.fallback}`);
    if (last?.error) console.log(`  error=${last.error}`);
    console.log("");
    if (result.done) break;
  }

  console.log("askCounts:", JSON.stringify(state.askCounts, null, 2));
  console.log("capabilityFlags:", capabilityFlags.length === 0 ? "(none)" : JSON.stringify(capabilityFlags));
  console.log("done:", state.done);
  console.log("summary:", state.transcript.filter((t) => t.role === "assistant").at(-1)?.content ?? "");

  const overAsked = Object.entries(state.askCounts).filter(([, n]) => n > 2);
  if (overAsked.length > 0) {
    console.error("FAIL: asked more than twice:", overAsked);
    process.exitCode = 1;
  }
  if (capabilityFlags.length > 0) {
    console.error("FAIL: capabilityFlag fired");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
