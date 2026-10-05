import type { CallTurn } from "./call-transcript";

export const SILENCE_GAP_SECONDS = 8;
export const SHORT_HANGUP_SECONDS = 10;

export type CallFlag =
  | { type: "long_silence"; seconds: number; offsetSeconds: number }
  | { type: "short_hangup"; durationSeconds: number }
  | { type: "tool_error"; toolName: string }
  | { type: "negative_sentiment" };

export type CallFlagInput = {
  durationSeconds?: number | null;
  sentiment?: string | null;
  endReason?: string | null;
};

function utteranceTimes(turns: CallTurn[]): Array<{ start: number; end: number; role: "agent" | "caller" | "transfer_target" }> {
  const out: Array<{ start: number; end: number; role: "agent" | "caller" | "transfer_target" }> = [];
  for (const turn of turns) {
    if (turn.kind !== "utterance") continue;
    if (turn.startSeconds == null || turn.endSeconds == null) continue;
    out.push({ start: turn.startSeconds, end: turn.endSeconds, role: turn.role });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Pure flag derivation from transcript turns + call metadata.
 * Safe to call from applyRetellCall and tests; no DB access.
 */
export function callFlags(turns: CallTurn[], call: CallFlagInput = {}): CallFlag[] {
  const flags: CallFlag[] = [];
  const utterances = utteranceTimes(turns);

  for (let i = 1; i < utterances.length; i += 1) {
    const prev = utterances[i - 1]!;
    const next = utterances[i]!;
    const gap = next.start - prev.end;
    if (gap > SILENCE_GAP_SECONDS) {
      flags.push({
        type: "long_silence",
        seconds: Math.round(gap),
        offsetSeconds: Math.max(0, Math.round(prev.end)),
      });
    }
  }

  const duration = call.durationSeconds ?? null;
  const hadGreeting = utterances.some((row) => row.role === "agent");
  if (hadGreeting && duration != null && duration <= SHORT_HANGUP_SECONDS) {
    flags.push({ type: "short_hangup", durationSeconds: duration });
  }

  for (const turn of turns) {
    if (turn.kind === "tool_call" && turn.successful === false) {
      flags.push({ type: "tool_error", toolName: turn.name || "tool" });
    }
  }

  if ((call.sentiment ?? "").toLowerCase() === "negative") {
    flags.push({ type: "negative_sentiment" });
  }

  return flags;
}

export function parseCallFlags(value: unknown): CallFlag[] {
  if (!Array.isArray(value)) return [];
  const out: CallFlag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "long_silence" && typeof row.seconds === "number" && typeof row.offsetSeconds === "number") {
      out.push({ type: "long_silence", seconds: row.seconds, offsetSeconds: row.offsetSeconds });
    } else if (row.type === "short_hangup" && typeof row.durationSeconds === "number") {
      out.push({ type: "short_hangup", durationSeconds: row.durationSeconds });
    } else if (row.type === "tool_error" && typeof row.toolName === "string") {
      out.push({ type: "tool_error", toolName: row.toolName });
    } else if (row.type === "negative_sentiment") {
      out.push({ type: "negative_sentiment" });
    }
  }
  return out;
}

export function flagExplanation(flag: CallFlag): string {
  switch (flag.type) {
    case "long_silence":
      return `${flag.seconds} seconds of silence at ${formatClock(flag.offsetSeconds)}.`;
    case "short_hangup":
      return `Caller hung up after ${flag.durationSeconds}s — right after the greeting.`;
    case "tool_error":
      return `A tool failed during the call (${flag.toolName}).`;
    case "negative_sentiment":
      return "The caller sounded unhappy.";
  }
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
