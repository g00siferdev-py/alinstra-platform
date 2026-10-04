"use client";

import { useRef, useState } from "react";

const SPEEDS = [1, 1.5, 2] as const;

/** Native audio element on our own playback route, with speed buttons. Preload metadata only. */
export function AudioPlayer({ src, contentType }: { src: string; contentType: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-2">
      <audio
        ref={ref}
        className="w-full"
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        onLoadedMetadata={() => {
          if (ref.current) ref.current.playbackRate = speed;
        }}
      >
        <source src={src} type={contentType} />
        Your browser cannot play this recording.
      </audio>
      <div className="flex items-center gap-2 text-xs" role="group" aria-label="Playback speed">
        <span className="text-[var(--muted)]">Speed</span>
        {SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={speed === option}
            className={`cursor-pointer rounded-md border px-2 py-1 ${speed === option ? "border-[var(--accent)] font-medium" : "border-[var(--line)]"}`}
            onClick={() => {
              setSpeed(option);
              if (ref.current) ref.current.playbackRate = option;
            }}
          >
            {option}×
          </button>
        ))}
      </div>
      {failed ? <p className="text-sm text-[var(--danger)]">The recording could not be loaded.</p> : null}
    </div>
  );
}
