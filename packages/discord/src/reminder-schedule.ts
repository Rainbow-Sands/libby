import type { CampaignReminderSchedule } from "@rainbot/db";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Accepts 24-hour ("19:30", "7") or 12-hour ("7:30 pm", "7pm") times and
// returns minutes after midnight, or null when the input is not a valid time.
export function parseTimeOfDay(input: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/i.exec(input.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Returns the canonical IANA name for a time zone, or null if it is unknown.
export function normalizeTimeZone(input: string): string | null {
  const timeZone = input.trim();
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// The first weekly session strictly after `after`, evaluated in the schedule's
// own time zone so daylight saving changes keep the same wall-clock time.
export function nextSessionAfter(schedule: CampaignReminderSchedule, after: Date): Date {
  const today = zonedDate(after, schedule.timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day) + offset * DAY_MS);
    if (day.getUTCDay() !== schedule.dayOfWeek) continue;
    const candidate = zonedTimeToUtc(day, schedule.minuteOfDay, schedule.timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  // Offset 7 is the same weekday next week, which is always after `after`.
  throw new Error(`No ${WEEKDAYS[schedule.dayOfWeek]} found after ${after.toISOString()}`);
}

interface ZonedDate {
  year: number;
  month: number;
  day: number;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function zonedDate(instant: Date, timeZone: string): ZonedDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

// Offset of `timeZone` from UTC at `instant`, in milliseconds.
function zoneOffset(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

// Converts a wall-clock time on a calendar day (given as a UTC midnight) in
// `timeZone` to an instant. Times skipped by a DST jump resolve to the
// equivalent instant after the jump.
function zonedTimeToUtc(day: Date, minuteOfDay: number, timeZone: string): Date {
  const wall = day.getTime() + minuteOfDay * MINUTE_MS;
  const firstGuess = wall - zoneOffset(wall, timeZone);
  const offset = zoneOffset(firstGuess, timeZone);
  return new Date(wall - offset);
}
