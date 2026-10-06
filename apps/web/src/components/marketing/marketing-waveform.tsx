type Props = {
  heights: number[];
  size?: "sm" | "lg";
  className?: string;
};

/** Decorative live waveform bars. Heights are fixed props — never randomized. */
export function MarketingWaveform({ heights, size = "sm", className = "" }: Props) {
  const barWidth = size === "lg" ? "w-1.5" : "w-[3px]";
  const gap = size === "lg" ? "gap-1.5" : "gap-[3px]";
  return (
    <span className={`marketing-wave ${gap} ${className}`.trim()} aria-hidden="true">
      {heights.map((height, index) => (
        <span key={index} className={barWidth} style={{ height: `${height}px` }} />
      ))}
    </span>
  );
}
