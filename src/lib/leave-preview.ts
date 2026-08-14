import { expandLeaveDays } from "@/server/policy/days";
import type { Portion } from "@/server/policy/types";
import { hoursToMinutes } from "./hours";

const DECIMAL_HOURS = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LeavePreviewInput = {
  startDate: string;
  endDate: string;
  portion: Portion;
  customHours?: string;
  consumesBalance: boolean;
  unlimited: boolean;
  availableMinutes: number;
  holidays: readonly string[];
  weekendDays: readonly number[];
  workdayMinutes: number;
  today: string;
};

export type LeavePreview =
  | {
      ok: true;
      intent: "log" | "request";
      thisMinutes: number;
      availableMinutes: number;
      availableAfterMinutes: number;
      dayCount: number;
    }
  | { ok: false; code: string; message: string };

export function previewLeave(input: LeavePreviewInput): LeavePreview {
  if (!ISO_DATE.test(input.startDate) || !ISO_DATE.test(input.endDate)) {
    return { ok: false, code: "INVALID_DATES", message: "Choose a start and end date." };
  }
  if (input.endDate < input.startDate) {
    return { ok: false, code: "INVALID_DATES", message: "endDate must be on or after startDate" };
  }
  if (input.startDate < input.today && input.today < input.endDate) {
    return {
      ok: false,
      code: "SPAN_CROSSES_TODAY",
      message: "Leave cannot start before today and end after today; file two submissions.",
    };
  }

  let customMinutes: number | null = null;
  if (input.portion === "custom") {
    const raw = (input.customHours ?? "").trim();
    if (!raw || !DECIMAL_HOURS.test(raw) || !Number.isFinite(Number(raw))) {
      return {
        ok: false,
        code: "INVALID_CUSTOM_HOURS",
        message: "customHours must be a decimal string",
      };
    }
    customMinutes = hoursToMinutes(raw);
  }

  let days: ReturnType<typeof expandLeaveDays>;
  try {
    days = expandLeaveDays({
      startDate: input.startDate,
      endDate: input.endDate,
      portion: input.portion,
      customMinutes,
      consumesBalance: input.consumesBalance,
      holidays: input.holidays.map((onDate) => ({ onDate })),
      weekendDays: input.weekendDays,
      workdayMinutes: input.workdayMinutes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid dates";
    return { ok: false, code: "INVALID_DATES", message };
  }

  if (days.length === 0) {
    return { ok: false, code: "HOLIDAYS_EXCLUDED", message: "No working days in the requested range." };
  }

  const thisMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
  const availableAfterMinutes = input.unlimited
    ? input.availableMinutes
    : input.availableMinutes - (input.consumesBalance ? thisMinutes : 0);

  return {
    ok: true,
    intent: input.endDate <= input.today ? "log" : "request",
    thisMinutes,
    availableMinutes: input.availableMinutes,
    availableAfterMinutes,
    dayCount: days.length,
  };
}
