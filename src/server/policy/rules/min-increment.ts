import type { Evaluation, ExpandedDay } from "../types";

export function minIncrement(input: {
  days: readonly ExpandedDay[];
  incrementMinutes: number | null | undefined;
}): Extract<Evaluation, { ok: false }> | null {
  const increment = input.incrementMinutes;
  if (increment == null || increment <= 0) return null;
  for (const day of input.days) {
    if (day.minutes % increment !== 0) {
      return {
        ok: false,
        code: "min_increment",
        message: `Each day's minutes must be a multiple of ${increment}.`,
      };
    }
  }
  return null;
}
