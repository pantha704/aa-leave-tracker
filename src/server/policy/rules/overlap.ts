import type { Evaluation, ExistingLeave, ExpandedDay, HolidayDate, Portion } from "../types";
import { expandLeaveDays } from "../days";

const INACTIVE = new Set(["rejected", "cancelled"]);

function portionsConflict(a: Portion, b: Portion): boolean {
  if (a === "full" || a === "custom" || b === "full" || b === "custom") return true;
  return a === b;
}

function occupyingDays(
  existing: readonly ExistingLeave[],
  input: {
    entryId?: string;
    holidays: readonly HolidayDate[];
    weekendDays: readonly number[];
    workdayMinutes: number;
  },
): { onDate: string; portion: Portion }[] {
  const occupied: { onDate: string; portion: Portion }[] = [];
  for (const row of existing) {
    if (input.entryId && row.id === input.entryId) continue;
    if (row.slotActive === false) continue;
    if (row.status && INACTIVE.has(row.status)) continue;
    if (!row.consumesBalance) continue;

    if (row.days && row.days.length > 0) {
      for (const day of row.days) {
        if (day.slotActive === false) continue;
        if (day.consumesBalance === false) continue;
        occupied.push({ onDate: day.onDate, portion: day.portion });
      }
      continue;
    }

    for (const day of expandLeaveDays({
      startDate: row.startDate,
      endDate: row.endDate,
      portion: row.portion,
      customMinutes: row.customMinutes,
      consumesBalance: true,
      holidays: input.holidays,
      weekendDays: input.weekendDays,
      workdayMinutes: input.workdayMinutes,
    })) {
      occupied.push({ onDate: day.onDate, portion: row.portion });
    }
  }
  return occupied;
}

export function overlap(input: {
  days: readonly ExpandedDay[];
  consumesBalance: boolean;
  existing: readonly ExistingLeave[];
  entryId?: string;
  holidays: readonly HolidayDate[];
  weekendDays: readonly number[];
  workdayMinutes: number;
}): Extract<Evaluation, { ok: false }> | null {
  if (!input.consumesBalance) return null;
  const occupied = occupyingDays(input.existing, input);
  for (const day of input.days) {
    for (const other of occupied) {
      if (other.onDate !== day.onDate) continue;
      if (portionsConflict(day.portion, other.portion)) {
        return {
          ok: false,
          code: "overlap",
          message: "This leave overlaps an existing consuming booking on the same day.",
        };
      }
    }
  }
  return null;
}
