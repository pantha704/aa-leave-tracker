import { describe, expect, it } from "vitest";
import { DEMO_SICK_GRANT_MINUTES } from "@/db/demo-policy";
import { csvHeaderColumns } from "./csv";
import {
  TERMINATION_CSV_HEADERS,
  TERMINATION_HOUR_COLUMNS,
  computeTerminationMinutes,
  countWorkingDays,
  terminationCsvHeader,
  terminationRowsToCsv,
} from "./termination";

describe("termination two-column CSV header", () => {
  it("always includes ledger_remaining and pro_rata_earned_to_end_date as distinct columns", () => {
    const header = terminationCsvHeader().trimEnd();
    const columns = csvHeaderColumns(header);
    expect(TERMINATION_HOUR_COLUMNS).toEqual([
      "ledger_remaining",
      "pro_rata_earned_to_end_date",
    ]);
    expect(columns).toContain("ledger_remaining");
    expect(columns).toContain("pro_rata_earned_to_end_date");
    expect(columns.filter((col) => TERMINATION_HOUR_COLUMNS.includes(col as (typeof TERMINATION_HOUR_COLUMNS)[number])))
      .toHaveLength(2);
    expect(header.includes("unused")).toBe(false);
  });

  it("empty export still emits the two payout columns", () => {
    const csv = terminationRowsToCsv([]);
    expect(csvHeaderColumns(csv)).toEqual([...TERMINATION_CSV_HEADERS]);
    expect(csv).toBe("email,leave_type,end_date,ledger_remaining,pro_rata_earned_to_end_date\n");
  });

  it("writes both hour figures on a data row", () => {
    const csv = terminationRowsToCsv([
      {
        email: "ada@example.com",
        leaveType: "sick",
        endDate: "2026-06-30",
        ledgerRemainingMinutes: DEMO_SICK_GRANT_MINUTES,
        proRataEarnedToEndDateMinutes: 720,
      },
    ]);
    expect(csvHeaderColumns(csv)).toEqual([...TERMINATION_CSV_HEADERS]);
    expect(csv).toContain("ada@example.com,sick,2026-06-30,24.00,12.00\n");
  });
});

describe("computeTerminationMinutes", () => {
  const period = {
    periodYear: 2026,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    endDate: "2026-06-30",
    weekendDays: [6, 7] as const,
  };

  it("keeps ledger remaining and pro-rata earned distinct for a front-loaded allotment", () => {
    const workingInPeriod = countWorkingDays({
      startDate: period.periodStart,
      endDate: period.periodEnd,
      weekendDays: period.weekendDays,
    });
    const workingThroughEnd = countWorkingDays({
      startDate: period.periodStart,
      endDate: period.endDate,
      weekendDays: period.weekendDays,
    });
    const expectedEarned = Math.round((DEMO_SICK_GRANT_MINUTES * workingThroughEnd) / workingInPeriod);

    const result = computeTerminationMinutes({
      ...period,
      grantMode: "lump_sum",
      grantMinutes: DEMO_SICK_GRANT_MINUTES,
      rows: [
        {
          kind: "grant_lump",
          minutes: DEMO_SICK_GRANT_MINUTES,
          effectiveOn: "2026-01-01",
          periodYear: 2026,
          reversedAt: null,
        },
      ],
    });

    expect(result.ledgerRemainingMinutes).toBe(DEMO_SICK_GRANT_MINUTES);
    expect(result.proRataEarnedToEndDateMinutes).toBe(expectedEarned);
    expect(result.proRataEarnedToEndDateMinutes).not.toBe(result.ledgerRemainingMinutes);
  });

  it("for accrual types is live accrual+carryover+adjustment minus taken through endDate", () => {
    const result = computeTerminationMinutes({
      ...period,
      grantMode: "periodic",
      grantMinutes: null,
      rows: [
        { kind: "accrual", minutes: 680, effectiveOn: "2026-01-01", periodYear: 2026, reversedAt: null },
        { kind: "accrual", minutes: 680, effectiveOn: "2026-02-01", periodYear: 2026, reversedAt: null },
        { kind: "accrual", minutes: 680, effectiveOn: "2026-07-01", periodYear: 2026, reversedAt: null },
        { kind: "adjustment", minutes: 60, effectiveOn: "2026-03-01", periodYear: 2026, reversedAt: null },
        { kind: "usage", minutes: -480, effectiveOn: "2026-04-01", periodYear: 2026, reversedAt: null },
        { kind: "usage", minutes: -120, effectiveOn: "2026-08-01", periodYear: 2026, reversedAt: null },
      ],
    });
    expect(result.ledgerRemainingMinutes).toBe(680 + 680 + 60 - 480);
    expect(result.proRataEarnedToEndDateMinutes).toBe(680 + 680 + 60 - 480);
  });
});
