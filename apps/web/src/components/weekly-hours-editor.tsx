"use client";

import { ErrorText } from "@/components/ui";
import { formatWeeklyHours, parseWeeklyHours, type WeeklyHours } from "@alinstra/db/domain";
import { useEffect, useMemo, useState } from "react";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

type DayState = { open: boolean; start: string; end: string };

function minutesToLabel(total: number): string {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const period = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function minutesToValue(total: number): string {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const total = index * 30;
  return { value: minutesToValue(total), label: minutesToLabel(total) };
});

function emptyDays(): Record<DayKey, DayState> {
  return Object.fromEntries(
    DAY_KEYS.map((day) => [day, { open: false, start: "09:00", end: "17:00" }]),
  ) as Record<DayKey, DayState>;
}

function daysFromText(text: string): Record<DayKey, DayState> {
  const base = emptyDays();
  const trimmed = text.trim();
  if (!trimmed) return base;
  try {
    const parsed = parseWeeklyHours(trimmed);
    for (const day of DAY_KEYS) {
      const row = parsed[day];
      if (row) base[day] = { open: true, start: row.start, end: row.end };
    }
  } catch {
    // Keep closed defaults when stored text is invalid.
  }
  return base;
}

function toWeeklyHours(days: Record<DayKey, DayState>): WeeklyHours {
  const hours: WeeklyHours = {};
  for (const day of DAY_KEYS) {
    const row = days[day];
    if (!row.open) continue;
    hours[day] = { start: row.start, end: row.end };
  }
  return hours;
}

export function weeklyHoursEditorError(days: Record<DayKey, DayState>): string | null {
  for (const day of DAY_KEYS) {
    const row = days[day];
    if (!row.open) continue;
    const [sh, sm] = row.start.split(":").map(Number);
    const [eh, em] = row.end.split(":").map(Number);
    if ((eh! * 60 + em!) <= (sh! * 60 + sm!)) {
      return "Closing time must be after opening time.";
    }
  }
  return null;
}

export function serializeWeeklyHours(days: Record<DayKey, DayState>): string {
  return formatWeeklyHours(toWeeklyHours(days));
}

export function WeeklyHoursEditor({
  weeklyHoursText,
  knowledgeHours,
  onChange,
  onValidityChange,
}: {
  weeklyHoursText: string;
  knowledgeHours?: string;
  onChange: (text: string) => void;
  onValidityChange?: (hasError: boolean) => void;
}) {
  const [days, setDays] = useState(() => daysFromText(weeklyHoursText));
  const error = useMemo(() => weeklyHoursEditorError(days), [days]);
  const empty = !weeklyHoursText.trim() && DAY_KEYS.every((day) => !days[day].open);
  const chatHours = knowledgeHours?.trim() ?? "";

  useEffect(() => {
    const next = serializeWeeklyHours(days);
    if (next !== weeklyHoursText) onChange(next);
    onValidityChange?.(Boolean(error));
  }, [days, error]);

  function patchDay(day: DayKey, patch: Partial<DayState>) {
    setDays((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
  }

  return (
    <div className="grid gap-3">
      {chatHours ? (
        <p className="text-sm text-[var(--muted)]">From your setup chat: {chatHours}</p>
      ) : null}
      <div className="grid gap-2">
        {DAY_KEYS.map((day) => {
          const row = days[day];
          return (
            <div
              key={day}
              className="flex items-center gap-1.5 sm:gap-3"
            >
              <label className="flex w-[6.5rem] shrink-0 cursor-pointer items-center gap-2 text-sm font-medium sm:w-28">
                <input
                  type="checkbox"
                  checked={row.open}
                  onChange={(event) => patchDay(day, { open: event.target.checked })}
                />
                {DAY_LABELS[day]}
              </label>
              {row.open ? (
                <>
                  <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">Opens</span>
                  <select
                    aria-label={`${DAY_LABELS[day]} opens`}
                    className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-2 py-2 text-sm sm:px-3 sm:py-2.5"
                    value={row.start}
                    onChange={(event) => patchDay(day, { start: event.target.value })}
                  >
                    {TIME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0 text-sm text-[var(--muted)]" aria-hidden="true">
                    –
                  </span>
                  <span className="sr-only">Closes</span>
                  <select
                    aria-label={`${DAY_LABELS[day]} closes`}
                    className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-2 py-2 text-sm sm:px-3 sm:py-2.5"
                    value={row.end}
                    onChange={(event) => patchDay(day, { end: event.target.value })}
                  >
                    {TIME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="text-sm text-[var(--muted)]">Closed</span>
              )}
            </div>
          );
        })}
      </div>
      {empty ? (
        <p className="text-sm text-[var(--muted)]">
          Set the hours Ava should treat as open. Transfers only happen during these hours.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
