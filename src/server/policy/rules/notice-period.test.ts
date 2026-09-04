import { describe, expect, it } from "vitest";
import { noticePeriod } from "./notice-period";

describe("noticePeriod", () => {
  it("blocks requests inside 14 calendar days unless an emergency/medical exception is recorded", () => {
    expect(
      noticePeriod({ startDate: "2026-06-10", today: "2026-06-01", noticeDays: 14 }),
    ).toMatchObject({ ok: false, code: "notice_period" });
    expect(
      noticePeriod({ startDate: "2026-06-15", today: "2026-06-01", noticeDays: 14 }),
    ).toBeNull();
    expect(
      noticePeriod({
        startDate: "2026-06-10",
        today: "2026-06-01",
        noticeDays: 14,
        exception: "emergency",
      }),
    ).toBeNull();
  });
});
