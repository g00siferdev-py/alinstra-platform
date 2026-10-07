/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatWeeklyHours, parseWeeklyHours } from "@alinstra/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeeklyHoursEditor, serializeWeeklyHours, weeklyHoursEditorError } from "./weekly-hours-editor";

afterEach(() => {
  cleanup();
});

describe("WeeklyHoursEditor", () => {
  it("round-trips formatWeeklyHours / parseWeeklyHours", () => {
    const text = "mon 08:00-17:00\nfri 09:00-12:00";
    const parsed = parseWeeklyHours(text);
    expect(formatWeeklyHours(parsed)).toBe(text);

    const onChange = vi.fn();
    render(<WeeklyHoursEditor weeklyHoursText={text} onChange={onChange} />);
    expect(screen.getByLabelText("Monday opens")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Tuesday/i));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(parseWeeklyHours(last).tue).toEqual({ start: "09:00", end: "17:00" });
  });

  it("rejects closing before opening", () => {
    const days = {
      mon: { open: true, start: "17:00", end: "08:00" },
      tue: { open: false, start: "09:00", end: "17:00" },
      wed: { open: false, start: "09:00", end: "17:00" },
      thu: { open: false, start: "09:00", end: "17:00" },
      fri: { open: false, start: "09:00", end: "17:00" },
      sat: { open: false, start: "09:00", end: "17:00" },
      sun: { open: false, start: "09:00", end: "17:00" },
    };
    expect(weeklyHoursEditorError(days)).toMatch(/Closing time must be after opening time/i);
    expect(serializeWeeklyHours({ ...days, mon: { open: true, start: "08:00", end: "17:00" } })).toContain(
      "mon 08:00-17:00",
    );
  });
});
