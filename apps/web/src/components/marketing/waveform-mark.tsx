/** Five vertical voice bars forming an A. Simple mark; refine later. */
export function WaveformMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="12" width="3" height="10" rx="1.2" />
      <rect x="6" y="6" width="3" height="16" rx="1.2" />
      <rect x="10.5" y="2" width="3" height="20" rx="1.2" />
      <rect x="15" y="6" width="3" height="16" rx="1.2" />
      <rect x="19.5" y="12" width="3" height="10" rx="1.2" />
    </svg>
  );
}
