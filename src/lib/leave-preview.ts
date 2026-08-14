import { hoursToMinutes } from "@/lib/hours";
import { expandLeaveDays } from "@/server/policy/days";
import { customPortion } from "@/server/policy/rules/min-increment";
import { negativeBalance } from "@/server/policy/rules/negative-balance";
import type { Portion } from "@/server/policy/types";

const POSITIVE_HOURS = /^\d+(\.\d+)?$/;

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
  incrementMinutes?: number | null;
  negativeAllowed?: boolean;
  negativeFloorMinutes?: number | null;
};

export type LeavePreview =
  | {
      ok: true;
      intent: "log" | "request";
      thisMinutes: number;
      availableMinutes: number;
      availableAfterMinutes: number | null;
      otherPeriodYear: boolean;
    }
  | { ok: false; code: string; message: string };

function apiCode(code: string): string {
  return code.toUpperCase();
}

export function previewLeave(input: LeavePreviewInput): LeavePreview {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
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
    if (!raw || !POSITIVE_HOURS.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
      return {
        ok: false,
        code: "INVALID_CUSTOM_HOURS",
        message: "customHours must be a positive decimal string",
      };
    }
    customMinutes = hoursToMinutes(raw);
    const custom = customPortion({
      portion: input.portion,
      customMinutes,
      workdayMinutes: input.workdayMinutes,
      incrementMinutes: input.incrementMinutes,
    });
    if (custom) return { ok: false, code: apiCode(custom.code), message: custom.message };
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
  const asOfYear = Number(input.today.slice(0, 4));
  const otherPeriodYear = days.some((day) => Number(day.onDate.slice(0, 4)) !== asOfYear);

  const negative = negativeBalance({
    balance: {
      takenMinutes: 0,
      scheduledMinutes: 0,
      requestedMinutes: 0,
      availableMinutes: input.availableMinutes,
    },
    thisMinutes,
    negativeAllowed: input.negativeAllowed ?? false,
    negativeFloorMinutes: input.negativeFloorMinutes,
    consumesBalance: input.consumesBalance,
    unlimited: input.unlimited,
  });
  if (negative && !otherPeriodYear) {
    return { ok: false, code: apiCode(negative.code), message: negative.message };
  }

  const availableAfterMinutes =
    input.unlimited || otherPeriodYear
      ? null
      : input.availableMinutes - (input.consumesBalance ? thisMinutes : 0);

  return {
    ok: true,
    intent: input.endDate <= input.today ? "log" : "request",
    thisMinutes,
    availableMinutes: input.availableMinutes,
    availableAfterMinutes,
    otherPeriodYear,
  };
}
