import { describe, expect, it } from "vitest";
import { DEMO_VACATION_GRANT_MINUTES, DEMO_VACATION_PERIODIC_MINUTES } from "@/db/demo-policy";
import {
  monthStartInZone,
  monthlyAccrualMinutes,
  planMonthlyAccrual,
  shouldPostMonthlyAccrual,
} from "./accrual";

describe("monthly accrual minutes", () => {
  it("posts periodic_minutes most months and the remainder in December", () => {
    expect(
      monthlyAccrualMinutes({
        month: 1,
        periodicMinutes: DEMO_VACATION_PERIODIC_MINUTES,
        grantMinutes: DEMO_VACATION_GRANT_MINUTES,
      }),
    ).toBe(DEMO_VACATION_PERIODIC_MINUTES);
    expect(
      monthlyAccrualMinutes({
        month: 12,
        periodicMinutes: 80,
        grantMinutes: 1000,
      }),
    ).toBe(120);
  });
});

describe("accrual job no-op until the period is open", () => {
  const target = {
    orgId: "org",
    timezone: "UTC",
    employeeId: "e",
    leaveTypeId: "vac",
    periodicMinutes: DEMO_VACATION_PERIODIC_MINUTES,
    grantMinutes: DEMO_VACATION_GRANT_MINUTES,
    accrualStopMinutes: null,
    startDate: "2027-01-01",
    endDate: null,
  };

  it("plans nothing when the period is future, closing, closed, or missing", () => {
    for (const status of ["future", "closing", "closed", null]) {
      expect(
        planMonthlyAccrual({
          periodStatus: status,
          monthStart: "2027-01-01",
          target,
          liveAccrualExists: false,
          grantedCredits: 0,
        }),
      ).toBeNull();
    }
  });

  it("plans January vacation accrual after the period is open", () => {
    const planned = planMonthlyAccrual({
      periodStatus: "open",
      monthStart: "2027-01-01",
      target,
      liveAccrualExists: false,
      grantedCredits: 0,
    });
    expect(planned).toEqual({
      employeeId: "e",
      leaveTypeId: "vac",
      minutes: DEMO_VACATION_PERIODIC_MINUTES,
      effectiveOn: "2027-01-01",
      reason: "accrual:2027-01-01",
    });
  });

  it("is a no-op when a live accrual already exists for that month", () => {
    expect(
      shouldPostMonthlyAccrual({
        periodStatus: "open",
        monthStart: "2027-01-01",
        startDate: "2027-01-01",
        endDate: null,
        liveAccrualExists: true,
        grantedCredits: 680,
        accrualStopMinutes: null,
        minutes: 680,
      }),
    ).toBe(false);
  });

  it("uses the 1st of the month in the org timezone", () => {
    expect(monthStartInZone("2027-01-15T23:00:00.000Z", "UTC")).toBe("2027-01-01");
    expect(monthStartInZone("2026-12-31T22:00:00.000Z", "Pacific/Auckland")).toBe("2027-01-01");
  });
});
