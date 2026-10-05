import { describe, expect, it } from "vitest";
import { callFlags, flagExplanation } from "./call-flags";
import { callTimeline } from "./call-timeline";
import type { CallTurn } from "./call-transcript";

const turns: CallTurn[] = [
  { kind: "utterance", role: "agent", text: "Hi, thanks for calling.", startSeconds: 0, endSeconds: 2 },
  { kind: "utterance", role: "caller", text: "Hello?", startSeconds: 15, endSeconds: 16 },
  { kind: "tool_call", toolCallId: "t1", name: "send_sms", args: null, result: "fail", successful: false },
];

describe("callFlags", () => {
  it("detects silence, short hangup, tool error, and negative sentiment", () => {
    const flags = callFlags(turns, { durationSeconds: 8, sentiment: "Negative" });
    expect(flags.map((flag) => flag.type).sort()).toEqual([
      "long_silence",
      "negative_sentiment",
      "short_hangup",
      "tool_error",
    ]);
    const silence = flags.find((flag) => flag.type === "long_silence");
    expect(silence).toMatchObject({ type: "long_silence", seconds: 13, offsetSeconds: 2 });
    expect(flagExplanation(silence!)).toContain("13 seconds");
  });
});

describe("callTimeline", () => {
  it("inserts silence segments for long gaps", () => {
    const segments = callTimeline(turns, 20);
    expect(segments.some((segment) => segment.kind === "silence" && segment.endSeconds - segment.startSeconds >= 8)).toBe(true);
    expect(segments.some((segment) => segment.kind === "agent")).toBe(true);
    expect(segments.some((segment) => segment.kind === "caller")).toBe(true);
  });
});
