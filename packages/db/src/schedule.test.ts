import { describe, expect, it } from "vitest";
import { nextSessionAfter, normalizeTimeZone, parseTimeOfDay } from "./schedule.ts";

describe("parseTimeOfDay", () => {
  it("parses 24-hour and 12-hour times", () => {
    expect(parseTimeOfDay("19:30")).toBe(19 * 60 + 30);
    expect(parseTimeOfDay("7")).toBe(7 * 60);
    expect(parseTimeOfDay("7:30 pm")).toBe(19 * 60 + 30);
    expect(parseTimeOfDay("7PM")).toBe(19 * 60);
    expect(parseTimeOfDay("12 a.m.")).toBe(0);
    expect(parseTimeOfDay("12:15pm")).toBe(12 * 60 + 15);
  });

  it("rejects invalid times", () => {
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("13 pm")).toBeNull();
    expect(parseTimeOfDay("7:60")).toBeNull();
    expect(parseTimeOfDay("tuesday")).toBeNull();
  });
});

describe("normalizeTimeZone", () => {
  it("accepts IANA names and rejects unknown zones", () => {
    expect(normalizeTimeZone(" America/St_Johns ")).toBe("America/St_Johns");
    expect(normalizeTimeZone("Not/AZone")).toBeNull();
    expect(normalizeTimeZone("")).toBeNull();
  });
});

describe("nextSessionAfter", () => {
  // Tuesday 19:30 in Newfoundland (UTC-2:30 in summer, UTC-3:30 in winter).
  const schedule = { dayOfWeek: 2, minuteOfDay: 19 * 60 + 30, timeZone: "America/St_Johns" };

  it("finds the session later the same week", () => {
    // Monday 2026-10-19 12:00 UTC
    const next = nextSessionAfter(schedule, new Date("2026-10-19T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-10-20T22:00:00.000Z");
  });

  it("rolls over to next week once the session has started", () => {
    const next = nextSessionAfter(schedule, new Date("2026-10-20T22:00:00Z"));
    expect(next.toISOString()).toBe("2026-10-27T22:00:00.000Z");
  });

  it("keeps the wall-clock time across a daylight saving change", () => {
    // DST ends on Sunday 2026-11-01 in North America.
    const next = nextSessionAfter(schedule, new Date("2026-10-28T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-03T23:00:00.000Z");
  });

  it("uses the local date of the schedule's time zone", () => {
    // Tuesday 01:00 UTC is still Monday evening in St. John's.
    const next = nextSessionAfter(schedule, new Date("2026-10-20T01:00:00Z"));
    expect(next.toISOString()).toBe("2026-10-20T22:00:00.000Z");
  });
});
