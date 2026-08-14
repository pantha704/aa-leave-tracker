import { describe, expect, it } from "vitest";
import { DEMO_WORKDAY_MINUTES } from "@/db/demo-policy";
import { expandToLeaveDays } from "./expand";

const MON = "2026-07-06";
const TUE = "2026-07-07";
const WED = "2026-07-08";
const FRI = "2026-07-10";
const SAT = "2026-07-11";
const SUN = "2026-07-12";

describe("expandToLeaveDays", () => {
  it("skips ISO weekends 6 and 7", () => {
    const days = expandToLeaveDays({
      startDate: FRI,
      endDate: SUN,
      portion: "full",
      consumesBalance: true,
      holidays: [],
      workdayMinutes: DEMO_WORKDAY_MINUTES,
    });
    expect(days.map((day) => day.onDate)).toEqual([FRI]);
    expect(days[0]?.minutes).toBe(DEMO_WORKDAY_MINUTES);
  });

  it("skips holidays only for consuming types; custom_minutes is per working day", () => {
    const consuming = expandToLeaveDays({
      startDate: MON,
      endDate: WED,
      portion: "custom",
      customMinutes: 160,
      consumesBalance: true,
      holidays: [{ onDate: TUE }],
      workdayMinutes: DEMO_WORKDAY_MINUTES,
    });
    expect(consuming.map((day) => ({ onDate: day.onDate, minutes: day.minutes }))).toEqual([
      { onDate: MON, minutes: 160 },
      { onDate: WED, minutes: 160 },
    ]);

    const wfh = expandToLeaveDays({
      startDate: MON,
      endDate: WED,
      portion: "custom",
      customMinutes: 160,
      consumesBalance: false,
      holidays: [{ onDate: TUE }],
      workdayMinutes: DEMO_WORKDAY_MINUTES,
    });
    expect(wfh.map((day) => day.onDate)).toEqual([MON, TUE, WED]);
    expect(wfh.every((day) => day.minutes === 160)).toBe(true);
  });
});
