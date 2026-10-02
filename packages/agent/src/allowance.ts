export type AllowanceState = {
  unlimited: boolean;
  remaining: number | null;
  over: boolean;
  feeCents: number;
};

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  let day = Number(bag.day);
  let month = Number(bag.month);
  let year = Number(bag.year);
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function offsetMs(timeZone: string, instant: Date): number {
  const parts = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const first = new Date(guess.getTime() - offsetMs(timeZone, guess));
  return new Date(guess.getTime() - offsetMs(timeZone, first));
}

export function calendarMonthRange(timeZone: string, now: Date): { start: Date; end: Date } {
  let zone = timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(now);
  } catch {
    zone = "America/New_York";
  }
  const parts = partsInZone(now, zone);
  const start = zonedMidnightUtc(parts.year, parts.month, 1, zone);
  const next = parts.month === 12 ? { year: parts.year + 1, month: 1 } : { year: parts.year, month: parts.month + 1 };
  const end = zonedMidnightUtc(next.year, next.month, 1, zone);
  return { start, end };
}

export function allowanceState(input: {
  included: number | null;
  used: number;
  extraChangeFeeCents: number;
}): AllowanceState {
  if (input.included === null) {
    return { unlimited: true, remaining: null, over: false, feeCents: 0 };
  }
  const remaining = Math.max(0, input.included - input.used);
  const over = input.used >= input.included;
  return {
    unlimited: false,
    remaining,
    over,
    feeCents: over ? input.extraChangeFeeCents : 0,
  };
}
