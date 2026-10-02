export type LineDiff = { op: "same" | "add" | "remove"; line: string };
export type FieldDiff = { field: string; before: string; after: string };

export function diffLines(before: string, after: string): LineDiff[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 250_000) {
    return [
      ...a.map((line) => ({ op: "remove" as const, line })),
      ...b.map((line) => ({ op: "add" as const, line })),
    ];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const next = dp[i + 1]?.[j + 1] ?? 0;
      const down = dp[i + 1]?.[j] ?? 0;
      const right = dp[i]?.[j + 1] ?? 0;
      const row = dp[i];
      if (row) row[j] = a[i] === b[j] ? next + 1 : Math.max(down, right);
    }
  }
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", line: a[i] ?? "" });
      i += 1;
      j += 1;
      continue;
    }
    const down = dp[i + 1]?.[j] ?? 0;
    const right = dp[i]?.[j + 1] ?? 0;
    if (down >= right) {
      out.push({ op: "remove", line: a[i] ?? "" });
      i += 1;
    } else {
      out.push({ op: "add", line: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ op: "remove", line: a[i] ?? "" });
    i += 1;
  }
  while (j < b.length) {
    out.push({ op: "add", line: b[j] ?? "" });
    j += 1;
  }
  return out;
}

function shown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: FieldDiff[] = [];
  for (const field of fields) {
    const left = shown(before[field]);
    const right = shown(after[field]);
    if (left !== right) changes.push({ field, before: left, after: right });
  }
  return changes;
}
