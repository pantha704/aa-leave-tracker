import type { Evaluation, ExpandedDay, PeriodStatus } from "../types";

export function closedPeriod(input: {
  days: readonly ExpandedDay[];
  periodStatuses: readonly PeriodStatus[];
}): Extract<Evaluation, { ok: false }> | null {
  const closedYears = new Set(
    input.periodStatuses.filter((period) => period.status === "closed").map((period) => period.year),
  );
  if (closedYears.size === 0) return null;
  for (const day of input.days) {
    const year = Number(day.onDate.slice(0, 4));
    if (closedYears.has(year)) {
      return {
        ok: false,
        code: "closed_period",
        message: `Cannot add usage in closed period year ${year}.`,
      };
    }
  }
  return null;
}
