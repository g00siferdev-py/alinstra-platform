/** Inline SVG: phone ringing into a waveform. The only marketing illustration. */
export function HeroPhone({ className = "h-40 w-full max-w-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 160" fill="none" aria-hidden="true">
      <rect x="24" y="28" width="72" height="112" rx="14" stroke="currentColor" strokeWidth="2" className="text-[var(--line)]" />
      <rect x="36" y="44" width="48" height="72" rx="4" fill="currentColor" className="text-[var(--card)]" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="60" cy="128" r="5" fill="currentColor" className="text-[var(--accent)]" />
      <path d="M108 80h36" stroke="currentColor" strokeWidth="2" className="text-[var(--muted)]" strokeDasharray="4 4" />
      <g className="text-[var(--accent)]" fill="currentColor">
        <rect x="156" y="70" width="10" height="40" rx="3" />
        <rect x="176" y="50" width="10" height="60" rx="3" />
        <rect x="196" y="30" width="10" height="80" rx="3" />
        <rect x="216" y="50" width="10" height="60" rx="3" />
        <rect x="236" y="70" width="10" height="40" rx="3" />
      </g>
      <circle cx="280" cy="48" r="3" fill="currentColor" className="text-[var(--muted)]" opacity="0.5" />
      <circle cx="296" cy="64" r="2" fill="currentColor" className="text-[var(--muted)]" opacity="0.4" />
    </svg>
  );
}
