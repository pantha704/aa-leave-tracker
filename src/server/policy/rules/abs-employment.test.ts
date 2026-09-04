import { describe, expect, it } from "vitest";
import { employmentNoticeRestriction, probationRestriction } from "./abs-employment";

describe("probationRestriction", () => {
  it("denies ordinary PTO before probation_end_date and allows a 1–2 day emergency", () => {
    expect(
      probationRestriction({
        startDate: "2026-03-02",
        endDate: "2026-03-06",
        today: "2026-03-01",
        leaveTypeCode: "pto",
        probationEndDate: "2026-07-01",
        override: false,
      }),
    ).toMatchObject({ ok: false, code: "probation" });
    expect(
      probationRestriction({
        startDate: "2026-03-02",
        endDate: "2026-03-03",
        today: "2026-03-01",
        leaveTypeCode: "pto",
        probationEndDate: "2026-07-01",
        override: false,
        noticeException: "emergency",
      }),
    ).toBeNull();
  });
});

describe("employmentNoticeRestriction", () => {
  it("denies ordinary PTO on/after notice-period start unless overridden", () => {
    expect(
      employmentNoticeRestriction({
        startDate: "2026-09-01",
        leaveTypeCode: "pto",
        noticePeriodStartDate: "2026-08-15",
        override: false,
      }),
    ).toMatchObject({ ok: false, code: "employment_notice" });
    expect(
      employmentNoticeRestriction({
        startDate: "2026-09-01",
        leaveTypeCode: "pto",
        noticePeriodStartDate: "2026-08-15",
        override: true,
      }),
    ).toBeNull();
  });
});
