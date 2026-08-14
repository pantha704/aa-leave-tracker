import { inclusiveIsoDates, isLiveLedgerRow, type LedgerSumRow } from "@/server/ledger/balance";
import { isoWeekday } from "@/server/policy/days";
import { minutesToHours, toCsv } from "./csv";

/** Payout columns — never a single "unused" hour figure. */
export const TERMINATION_HOUR_COLUMNS = [
  "ledger_remaining",
  "pro_rata_earned_to_end_date",
] as const;

export const TERMINATION_CSV_HEADERS = [
  "email",
  "leave_type",
  "end_date",
  ...TERMINATION_HOUR_COLUMNS,
] as const;

export type TerminationGrantMode = "lump_sum" | "periodic" | "hourly_worked" | "none";

export type TerminationExportRow = {
  email: string;
  leaveType: string;
  endDate: string;
  ledgerRemainingMinutes: number;
  proRataEarnedToEndDateMinutes: number;
};

export function terminationCsvHeader(): string {
  return `${TERMINATION_CSV_HEADERS.join(",")}\n`;
}

export function countWorkingDays(input: {
  startDate: string;
  endDate: string;
  weekendDays?: readonly number[];
  holidays?: ReadonlySet<string>;
}): number {
  if (input.endDate < input.startDate) return 0;
  const weekend = new Set(input.weekendDays ?? [6, 7]);
  const holidays = input.holidays ?? new Set<string>();
  let count = 0;
  for (const onDate of inclusiveIsoDates(input.startDate, input.endDate)) {
    if (weekend.has(isoWeekday(onDate))) continue;
    if (holidays.has(onDate)) continue;
    count += 1;
  }
  return count;
}

/** Org-global holiday dates only. Regional rows stay out until per-employee location exists. */
export function orgGlobalHolidayDates(
  rows: readonly { onDate: string; region?: string | null }[],
): Set<string> {
  return new Set(rows.filter((row) => row.region == null).map((row) => row.onDate));
}

export function computeTerminationMinutes(input: {
  grantMode: TerminationGrantMode;
  grantMinutes: number | null;
  rows: readonly LedgerSumRow[];
  endDate: string;
  periodYear: number;
  periodStart: string;
  periodEnd: string;
  employeeStartDate?: string;
  weekendDays?: readonly number[];
  holidays?: ReadonlySet<string>;
}): { ledgerRemainingMinutes: number; proRataEarnedToEndDateMinutes: number } {
  const live = input.rows.filter((row) => isLiveLedgerRow(row) && row.effectiveOn <= input.endDate);
  const ledgerRemainingMinutes = live.reduce((sum, row) => sum + row.minutes, 0);

  const takenMinutes = live
    .filter((row) => row.kind === "usage")
    .reduce((sum, row) => sum + -row.minutes, 0);
  const takenInPeriod = live
    .filter((row) => row.kind === "usage" && row.periodYear === input.periodYear)
    .reduce((sum, row) => sum + -row.minutes, 0);

  if (input.grantMode === "lump_sum") {
    const allotment = input.grantMinutes ?? 0;
    const throughStart =
      input.employeeStartDate && input.employeeStartDate > input.periodStart
        ? input.employeeStartDate
        : input.periodStart;
    const workingInPeriod = countWorkingDays({
      startDate: input.periodStart,
      endDate: input.periodEnd,
      weekendDays: input.weekendDays,
      holidays: input.holidays,
    });
    const workingThroughEnd = countWorkingDays({
      startDate: throughStart,
      endDate: input.endDate,
      weekendDays: input.weekendDays,
      holidays: input.holidays,
    });
    const earnedMinutes =
      workingInPeriod === 0 ? 0 : Math.round((allotment * workingThroughEnd) / workingInPeriod);
    return {
      ledgerRemainingMinutes,
      proRataEarnedToEndDateMinutes: earnedMinutes - takenInPeriod,
    };
  }

  const earnedMinutes = live
    .filter((row) => row.kind === "accrual" || row.kind === "carryover" || row.kind === "adjustment")
    .reduce((sum, row) => sum + row.minutes, 0);

  return {
    ledgerRemainingMinutes,
    proRataEarnedToEndDateMinutes: earnedMinutes - takenMinutes,
  };
}

export function terminationRowsToCsv(rows: readonly TerminationExportRow[]): string {
  return toCsv(
    TERMINATION_CSV_HEADERS,
    rows.map((row) => [
      row.email,
      row.leaveType,
      row.endDate,
      minutesToHours(row.ledgerRemainingMinutes),
      minutesToHours(row.proRataEarnedToEndDateMinutes),
    ]),
  );
}
