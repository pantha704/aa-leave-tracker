import {
  DEFAULT_WEEKEND_DAYS,
  expandLeaveDays,
  isoWeekday,
  minutesForPortion,
} from "@/server/policy/days";
import type { HolidayDate, Portion } from "@/server/policy/types";

export type LeaveDayDraft = {
  onDate: string;
  minutes: number;
  portion: Portion;
  consumesBalance: boolean;
  slotActive: true;
};

/**
 * custom_minutes is copied onto every working day (not split across the range).
 * Weekends are never LeaveDays. Holidays are skipped only when the type consumes balance.
 */
export function expandToLeaveDays(input: {
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes?: number | null;
  consumesBalance: boolean;
  holidays: readonly HolidayDate[];
  weekendDays?: readonly number[];
  workdayMinutes: number;
}): LeaveDayDraft[] {
  return expandLeaveDays({
    startDate: input.startDate,
    endDate: input.endDate,
    portion: input.portion,
    customMinutes: input.customMinutes,
    consumesBalance: input.consumesBalance,
    holidays: input.holidays,
    weekendDays: input.weekendDays ?? DEFAULT_WEEKEND_DAYS,
    workdayMinutes: input.workdayMinutes,
  }).map((day) => ({
    onDate: day.onDate,
    minutes: day.minutes,
    portion: day.portion,
    consumesBalance: input.consumesBalance,
    slotActive: true,
  }));
}

export { DEFAULT_WEEKEND_DAYS, expandLeaveDays, isoWeekday, minutesForPortion };
