export type LedgerRemainingInput = {
  id: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  kind: string;
  reversedAt: Date | string | null;
  createdAt: Date | string;
};

function isLive(row: Pick<LedgerRemainingInput, "reversedAt" | "kind">): boolean {
  return row.reversedAt == null && row.kind !== "reversal";
}

function createdKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Oldest-first live SUM in periodYear, then newest-first for display. */
export function withRunningRemaining<T extends LedgerRemainingInput>(
  rows: readonly T[],
  periodYear: number,
): Array<T & { remainingMinutes: number | null }> {
  const inYear = rows.filter((row) => row.periodYear === periodYear);
  const oldestLive = inYear
    .filter(isLive)
    .slice()
    .sort((a, b) => {
      const byDate = a.effectiveOn.localeCompare(b.effectiveOn);
      if (byDate !== 0) return byDate;
      return createdKey(a.createdAt).localeCompare(createdKey(b.createdAt));
    });

  const remainingById = new Map<string, number>();
  let running = 0;
  for (const row of oldestLive) {
    running += row.minutes;
    remainingById.set(row.id, running);
  }

  return inYear
    .slice()
    .sort((a, b) => {
      const byDate = b.effectiveOn.localeCompare(a.effectiveOn);
      if (byDate !== 0) return byDate;
      return createdKey(b.createdAt).localeCompare(createdKey(a.createdAt));
    })
    .map((row) => ({
      ...row,
      remainingMinutes: remainingById.get(row.id) ?? null,
    }));
}
