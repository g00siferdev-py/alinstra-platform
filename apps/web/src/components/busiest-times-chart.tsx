import type { BusiestCell } from "@alinstra/db";
import { WEEKDAYS } from "@alinstra/db";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Accessible weekday × hour heatmap (table) plus a simple SVG bar chart of totals by hour.
 * Server-rendered; no chart library.
 */
export function BusiestTimesChart({ cells, className = "" }: { cells: BusiestCell[]; className?: string }) {
  const grid = new Map<string, number>();
  let max = 0;
  for (const cell of cells) {
    grid.set(`${cell.weekday}-${cell.hour}`, cell.count);
    if (cell.count > max) max = cell.count;
  }

  const byHour = HOURS.map((hour) => {
    let total = 0;
    for (let weekday = 0; weekday < 7; weekday += 1) total += grid.get(`${weekday}-${hour}`) ?? 0;
    return { hour, total };
  });
  const hourMax = Math.max(1, ...byHour.map((row) => row.total));

  const svgWidth = 560;
  const svgHeight = 120;
  const barGap = 2;
  const barWidth = (svgWidth - barGap * 23) / 24;

  return (
    <div className={`grid gap-4 ${className}`.trim()}>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs" aria-label="Calls by weekday and hour">
          <caption className="sr-only">Number of calls by weekday and hour of day in the client timezone</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-[var(--surface)] px-2 py-1 font-semibold text-[var(--muted)]">
                Day
              </th>
              {HOURS.map((hour) => (
                <th key={hour} scope="col" className="px-1 py-1 text-center font-semibold text-[var(--muted)]">
                  {hour}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((label, weekday) => (
              <tr key={label}>
                <th scope="row" className="sticky left-0 bg-[var(--surface)] px-2 py-1 font-semibold text-[var(--ink)]">
                  {label}
                </th>
                {HOURS.map((hour) => {
                  const count = grid.get(`${weekday}-${hour}`) ?? 0;
                  const intensity = max > 0 ? count / max : 0;
                  const bg =
                    count === 0
                      ? "transparent"
                      : `color-mix(in srgb, var(--primary) ${Math.round(18 + intensity * 72)}%, transparent)`;
                  return (
                    <td
                      key={hour}
                      className="px-1 py-1 text-center tabular-nums text-[var(--ink)]"
                      style={{ background: bg }}
                      title={`${label} ${hour}:00 — ${count} call${count === 1 ? "" : "s"}`}
                    >
                      {count > 0 ? count : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figure className="grid gap-2">
        <figcaption className="text-sm font-semibold text-[var(--ink)]">Calls by hour of day</figcaption>
        <svg
          role="img"
          aria-label="Bar chart of total calls by hour of day"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="h-auto w-full max-w-full"
        >
          {byHour.map((row, index) => {
            const height = row.total > 0 ? Math.max(2, (row.total / hourMax) * (svgHeight - 20)) : 0;
            const x = index * (barWidth + barGap);
            const y = svgHeight - 16 - height;
            return (
              <g key={row.hour}>
                <rect x={x} y={y} width={barWidth} height={height} fill="var(--primary)" rx="2" />
                {index % 3 === 0 ? (
                  <text x={x + barWidth / 2} y={svgHeight - 4} textAnchor="middle" className="fill-[var(--muted)]" fontSize="9">
                    {row.hour}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </figure>
    </div>
  );
}
