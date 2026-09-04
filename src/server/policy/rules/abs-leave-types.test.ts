import { describe, expect, it } from "vitest";
import {
  consecutivePtoLimit,
  lwopEligibility,
  sickDocumentationMayBeRequired,
} from "./abs-leave-types";

describe("consecutivePtoLimit", () => {
  it("rejects standard PTO longer than 21 calendar days", () => {
    expect(
      consecutivePtoLimit({
        startDate: "2026-07-06",
        endDate: "2026-07-28",
        leaveTypeCode: "pto",
        override: false,
      }),
    ).toMatchObject({ ok: false, code: "max_consecutive" });
    expect(
      consecutivePtoLimit({
        startDate: "2026-07-06",
        endDate: "2026-07-22",
        leaveTypeCode: "pto",
        override: false,
      }),
    ).toBeNull();
  });
});

describe("sickDocumentationMayBeRequired", () => {
  it("flags sick spanning more than two workdays", () => {
    expect(sickDocumentationMayBeRequired({ leaveTypeCode: "sick", workdayCount: 3 })).toBe(true);
    expect(sickDocumentationMayBeRequired({ leaveTypeCode: "sick", workdayCount: 2 })).toBe(false);
    expect(sickDocumentationMayBeRequired({ leaveTypeCode: "pto", workdayCount: 5 })).toBe(false);
  });
});

describe("lwopEligibility", () => {
  it("requires a qualifying condition and exhausted PTO", () => {
    expect(
      lwopEligibility({
        leaveTypeCode: "lwop",
        ptoAvailableMinutes: 0,
        qualifyingCondition: "",
        override: false,
      }),
    ).toMatchObject({ ok: false, code: "lwop_eligibility" });
    expect(
      lwopEligibility({
        leaveTypeCode: "lwop",
        ptoAvailableMinutes: 480,
        qualifyingCondition: "exhausted PTO after travel delay",
        override: false,
      }),
    ).toMatchObject({ ok: false, code: "lwop_eligibility" });
    expect(
      lwopEligibility({
        leaveTypeCode: "lwop",
        ptoAvailableMinutes: 0,
        qualifyingCondition: "exhausted PTO after travel delay",
        override: false,
      }),
    ).toBeNull();
  });
});
