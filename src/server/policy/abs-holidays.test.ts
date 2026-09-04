import { describe, expect, it } from "vitest";
import { isOfficialAbsHoliday, officialAbsHolidayDates, thanksgivingDate } from "./abs-holidays";

describe("officialAbsHolidayDates", () => {
  it("uses Jan 1, fourth Thursday of November, and Dec 25 with no observed-day shift", () => {
    expect(thanksgivingDate(2026)).toBe("2026-11-26");
    expect(officialAbsHolidayDates(2026)).toEqual(["2026-01-01", "2026-11-26", "2026-12-25"]);
    expect(isOfficialAbsHoliday("2026-12-25")).toBe(true);
    expect(isOfficialAbsHoliday("2026-12-26")).toBe(false);
  });
});
