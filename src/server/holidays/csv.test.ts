import { describe, expect, it } from "vitest";
import {
  holidayCsvErrorsToCsv,
  holidayUniqueKey,
  mapHolidayHeaders,
  normalizeHolidayHeader,
  parseHolidayCsv,
  parseIsoDate,
} from "./csv";

describe("holiday CSV header map", () => {
  it("maps date, name, and optional region aliases", () => {
    expect(mapHolidayHeaders(["On Date", "Holiday Name", "Location"])).toEqual({
      date: 0,
      name: 1,
      region: 2,
    });
    expect(mapHolidayHeaders(["date", "name"])).toEqual({
      date: 0,
      name: 1,
      region: null,
    });
    expect(normalizeHolidayHeader("\uFEFFHoliday-Date")).toBe("holiday_date");
  });

  it("rejects a header row without date or name", () => {
    expect(mapHolidayHeaders(["foo", "bar"])).toEqual({
      error: "header must include date and name columns",
    });
    expect(parseHolidayCsv("foo,bar\n2026-01-01,x").errors[0]).toMatchObject({
      line: 1,
      message: "header must include date and name columns",
    });
  });
});

describe("parseHolidayCsv", () => {
  it("parses ISO dates and treats empty region as null", () => {
    const csv = ["date,name,region", "2026-01-01,New Year,", "2026-12-25,Christmas,US"].join("\n");
    const result = parseHolidayCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, onDate: "2026-01-01", name: "New Year", region: null },
      { line: 3, onDate: "2026-12-25", name: "Christmas", region: "US" },
    ]);
  });

  it("collects a bad date row into an error list and error CSV", () => {
    const csv = ["date,name", "2026-13-40,Bad", "not-a-date,Worse"].join("\n");
    const result = parseHolidayCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, field: "date", message: "invalid date: 2026-13-40" },
      { line: 3, field: "date", message: "invalid date: not-a-date" },
    ]);
    expect(holidayCsvErrorsToCsv(result.errors)).toBe(
      ["line,message", "2,invalid date: 2026-13-40", "3,invalid date: not-a-date", ""].join("\n"),
    );
  });

  it("rejects in-file duplicates on (org, date, region) with empty region coalesced", () => {
    const csv = [
      "date,name,region",
      "2026-01-01,A,",
      "2026-01-01,B,",
      "2026-01-01,C,US",
      "2026-01-01,D,US",
    ].join("\n");
    const result = parseHolidayCsv(csv);
    expect(result.rows.map((r) => r.name)).toEqual(["A", "C"]);
    expect(result.errors).toEqual([
      { line: 3, message: "duplicate (org, date, region) of line 2" },
      { line: 5, message: "duplicate (org, date, region) of line 4" },
    ]);
    expect(holidayUniqueKey("2026-01-01", null)).toBe(holidayUniqueKey("2026-01-01", "  "));
    expect(holidayUniqueKey("2026-01-01", "US")).not.toBe(holidayUniqueKey("2026-01-01", null));
  });

  it("rejects impossible calendar dates", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("2026-02-28")).toBe("2026-02-28");
  });
});
