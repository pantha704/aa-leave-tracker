import type { Evaluation, ExpandedDay, PeriodStatus } from "../types";

const BLOCKED = new Set(["closed", "closing"]);

export function closedPeriod(input: {
  days: readonly ExpandedDay[];
  periodStatuses: readonly PeriodStatus[];
}): Extract<Evaluation, { ok: false }> | null {
  const byYear = new Map(input.periodStatuses.map((period) => [period.year, period.status]));
  for (const day of input.days) {
    const year = Number(day.onDate.slice(0, 4));
    const status = byYear.get(year);
    if (status == null || BLOCKED.has(status)) {
      return {
        ok: false,
        code: "closed_period",
        message: `Cannot add usage in closed period year ${year}.`,
      };
    }
  }
  return null;
}
