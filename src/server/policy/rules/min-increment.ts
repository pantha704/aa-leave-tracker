import type { Evaluation, ExpandedDay, Portion } from "../types";

type Fail = Extract<Evaluation, { ok: false }>;

function incrementFail(increment: number): Fail {
  return {
    ok: false,
    code: "min_increment",
    message: `Each day's minutes must be a multiple of ${increment}.`,
  };
}

/** Custom is hours per working day: required, positive, ≤ workday, and on the increment. */
export function customPortion(input: {
  portion: Portion;
  customMinutes?: number | null;
  workdayMinutes: number;
  incrementMinutes: number | null | undefined;
}): Fail | null {
  if (input.portion !== "custom") return null;
  const value = input.customMinutes;
  if (value == null || !Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      code: "min_increment",
      message: "Custom leave requires a positive integer minutes per day.",
    };
  }
  if (value > input.workdayMinutes) {
    return {
      ok: false,
      code: "min_increment",
      message: `Custom minutes per day cannot exceed the workday (${input.workdayMinutes}).`,
    };
  }
  const increment = input.incrementMinutes;
  if (increment != null && increment > 0 && value % increment !== 0) {
    return incrementFail(increment);
  }
  return null;
}

export function minIncrement(input: {
  days: readonly ExpandedDay[];
  incrementMinutes: number | null | undefined;
}): Fail | null {
  const increment = input.incrementMinutes;
  if (increment == null || increment <= 0) return null;
  for (const day of input.days) {
    if (day.minutes % increment !== 0) {
      return incrementFail(increment);
    }
  }
  return null;
}
