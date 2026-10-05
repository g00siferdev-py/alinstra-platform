import type { CallTurn } from "./call-transcript";
import { SILENCE_GAP_SECONDS } from "./call-flags";

export type TimelineSegment = {
  kind: "agent" | "caller" | "silence";
  startSeconds: number;
  endSeconds: number;
};

/**
 * Builds colored timeline segments from utterance timestamps.
 * Gaps longer than SILENCE_GAP_SECONDS become silence segments.
 */
export function callTimeline(turns: CallTurn[], durationSeconds: number | null | undefined): TimelineSegment[] {
  const utterances = turns
    .filter((turn): turn is Extract<CallTurn, { kind: "utterance" }> => turn.kind === "utterance")
    .filter((turn) => turn.startSeconds != null && turn.endSeconds != null)
    .map((turn) => ({
      kind: (turn.role === "agent" ? "agent" : "caller") as "agent" | "caller",
      startSeconds: turn.startSeconds as number,
      endSeconds: Math.max(turn.endSeconds as number, (turn.startSeconds as number) + 0.2),
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (utterances.length === 0) {
    const end = Math.max(0, durationSeconds ?? 0);
    return end > 0 ? [{ kind: "silence", startSeconds: 0, endSeconds: end }] : [];
  }

  const segments: TimelineSegment[] = [];
  let cursor = 0;
  for (const utterance of utterances) {
    if (utterance.startSeconds - cursor > SILENCE_GAP_SECONDS) {
      segments.push({ kind: "silence", startSeconds: cursor, endSeconds: utterance.startSeconds });
    }
    segments.push({
      kind: utterance.kind,
      startSeconds: utterance.startSeconds,
      endSeconds: utterance.endSeconds,
    });
    cursor = Math.max(cursor, utterance.endSeconds);
  }

  const end = Math.max(cursor, durationSeconds ?? cursor);
  if (end - cursor > SILENCE_GAP_SECONDS) {
    segments.push({ kind: "silence", startSeconds: cursor, endSeconds: end });
  }

  return segments;
}

/** Deterministic decorative bar height 28–100 from call id + index. */
export function timelineBarHeight(callId: string, index: number): number {
  let hash = index * 31;
  for (let i = 0; i < callId.length; i += 1) hash = (hash * 33 + callId.charCodeAt(i)) % 10_000;
  return 28 + (hash % 73);
}
