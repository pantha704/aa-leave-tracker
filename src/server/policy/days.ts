import { inclusiveIsoDates, requireIsoDate } from "@/lib/iso-date";
import type { ExpandedDay, HolidayDate, Portion, ProposedLeave } from "./types";

export const DEFAULT_WEEKEND_DAYS = [6, 7] as const;

export function isoWeekday(isoDate: string): number {
  const value = requireIsoDate(isoDate);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function minutesForPortion(
  portion: Portion,
  workdayMinutes: number,
  customMinutes?: number | null,
): number {
  if (portion === "full") return workdayMinutes;
  if (portion === "am" || portion === "pm") return Math.trunc(workdayMinutes / 2);
  return customMinutes ?? 0;
}

export function resolveWorkdayMinutes(input: {
  employeeMinutes?: number | null;
  policyMinutes?: number | null;
}): number | null {
  const value = input.employeeMinutes ?? input.policyMinutes;
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function holidayDateSet(holidays: readonly HolidayDate[]): Set<string> {
  return new Set(holidays.map((holiday) => requireIsoDate(holiday.onDate, "holiday")));
}

/**
 * Consuming types skip holidays (and weekends). Non-consuming types keep holiday dates.
 */
export function expandLeaveDays(input: {
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes?: number | null;
  consumesBalance: boolean;
  holidays: readonly HolidayDate[];
  weekendDays?: readonly number[];
  workdayMinutes: number;
}): ExpandedDay[] {
  const weekendDays = new Set(input.weekendDays ?? DEFAULT_WEEKEND_DAYS);
  const holidays = holidayDateSet(input.holidays);
  const perDay = minutesForPortion(input.portion, input.workdayMinutes, input.customMinutes);
  const days: ExpandedDay[] = [];
  for (const onDate of inclusiveIsoDates(input.startDate, input.endDate)) {
    if (weekendDays.has(isoWeekday(onDate))) continue;
    if (input.consumesBalance && holidays.has(onDate)) continue;
    days.push({ onDate, minutes: perDay, portion: input.portion });
  }
  return days;
}

export function expandProposedDays(
  entry: ProposedLeave,
  input: {
    consumesBalance: boolean;
    holidays: readonly HolidayDate[];
    weekendDays?: readonly number[];
    workdayMinutes: number;
  },
): ExpandedDay[] {
  return expandLeaveDays({
    startDate: entry.startDate,
    endDate: entry.endDate,
    portion: entry.portion,
    customMinutes: entry.customMinutes,
    consumesBalance: input.consumesBalance,
    holidays: input.holidays,
    weekendDays: input.weekendDays,
    workdayMinutes: input.workdayMinutes,
  });
}
