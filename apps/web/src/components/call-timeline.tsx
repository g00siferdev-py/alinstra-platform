"use client";

import { timelineBarHeight, type TimelineSegment } from "@alinstra/db";
import { formatOffset } from "@/lib/call-view";

const colors = {
  agent: "var(--live-strong)",
  caller: "var(--primary)",
  silence: "#F3C89A",
};

export function CallTimelineBars({
  callId,
  segments,
  durationSeconds,
}: {
  callId: string;
  segments: TimelineSegment[];
  durationSeconds: number | null;
}) {
  const total = Math.max(durationSeconds ?? 0, ...segments.map((segment) => segment.endSeconds), 1);
  return (
    <div className="flex h-12 items-end gap-0.5 overflow-hidden rounded-xl bg-[var(--surface-subtle)] px-2 py-1.5" aria-hidden="true">
      {segments.map((segment, index) => {
        const widthPct = Math.max(1.5, ((segment.endSeconds - segment.startSeconds) / total) * 100);
        const height = timelineBarHeight(callId, index);
        return (
          <span
            key={`${segment.kind}-${segment.startSeconds}-${index}`}
            className="rounded-sm"
            style={{
              width: `${widthPct}%`,
              height: `${height}%`,
              background: colors[segment.kind],
              opacity: segment.kind === "silence" ? 0.9 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

export function CallTimelineLegend({ segments }: { segments: TimelineSegment[] }) {
  const silences = segments.filter((segment) => segment.kind === "silence");
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors.agent }} /> Ava
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors.caller }} /> Caller
      </span>
      {silences.map((segment, index) => (
        <span key={`${segment.startSeconds}-${index}`} className="inline-flex items-center gap-1.5 text-[var(--warning-text)]">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors.silence }} />
          {Math.round(segment.endSeconds - segment.startSeconds)} seconds of silence at {formatOffset(segment.startSeconds)}
        </span>
      ))}
    </div>
  );
}
