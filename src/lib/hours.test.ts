import { describe, expect, it } from "vitest";
import { formatDays, formatHours, hoursToMinutes, minutesToHours } from "./hours";

describe("hours display", () => {
  it("rounds 1/3 of an 8h day the same way submit does", () => {
    expect(hoursToMinutes("2.67")).toBe(160);
    expect(formatHours(160)).toBe("2.67");
  });

  it("labels DEMO monthly accrual as 11.33h", () => {
    expect(minutesToHours(680)).toBe(11.33);
    expect(formatHours(680)).toBe("11.33");
  });

  it("keeps signed ledger usage negative", () => {
    expect(formatHours(-480)).toBe("-8.00");
  });
});

describe("days display", () => {
  it("labels 17 DEMO days from minutes / workday", () => {
    expect(formatDays(8160, 480)).toBe("17.00");
  });
});
