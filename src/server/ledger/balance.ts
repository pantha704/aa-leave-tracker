import { and, eq, isNull, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { employees, leaveEntries, ledgerEntries, organizations } from "@/db/schema";

/** Credits that make up grantedMinutes. Adjustment is NET (negatives included). */
export const GRANTED_KINDS = ["grant_lump", "accrual", "carryover", "adjustment"] as const;

export type GrantedKind = (typeof GRANTED_KINDS)[number];

export type LedgerKind = GrantedKind | "usage" | "forfeit" | "reversal";

export type Balance = {
  grantedMinutes: number;
  takenMinutes: number;
  scheduledMinutes: number;
  requestedMinutes: number;
  remainingMinutes: number;
  availableMinutes: number;
  asOf: Date;
};

export type LedgerSumRow = {
  kind: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  reversedAt: Date | null;
};

export type PendingEntrySumRow = {
  status: string;
  totalMinutes: number;
  startDate: string;
  endDate: string;
};

export type LedgerDb = PostgresJsDatabase<Record<string, unknown>>;

export function isLiveLedgerRow(row: Pick<LedgerSumRow, "reversedAt" | "kind">): boolean {
  return row.reversedAt == null && row.kind !== "reversal";
}

export function isGrantedKind(kind: string): kind is GrantedKind {
  return (GRANTED_KINDS as readonly string[]).includes(kind);
}

/** Calendar YYYY-MM-DD in an IANA zone. Bare dates are already org-local. */
export function asOfDateString(asOf: Date | string, timeZone: string): string {
  if (typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return asOf;
  }
  const instant = typeof asOf === "string" ? new Date(asOf) : asOf;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function periodYearFromAsOf(asOf: Date | string, timeZone: string): number {
  return Number(asOfDateString(asOf, timeZone).slice(0, 4));
}

function calendarYearBounds(periodYear: number): { yearStart: string; yearEnd: string } {
  return { yearStart: `${periodYear}-01-01`, yearEnd: `${periodYear}-12-31` };
}

/**
 * Four-bucket SUM. remainingMinutes is only this: SUM(live ledger minutes in period).
 * Live = reversed_at IS NULL AND kind <> 'reversal'.
 */
export function computeBalance(input: {
  rows: readonly LedgerSumRow[];
  pendingEntries: readonly PendingEntrySumRow[];
  asOf: Date | string;
  timeZone: string;
  periodYear?: number;
}): Balance {
  const asOf = asOfDateString(input.asOf, input.timeZone);
  const periodYear = input.periodYear ?? periodYearFromAsOf(asOf, input.timeZone);
  const live = input.rows.filter((row) => isLiveLedgerRow(row) && row.periodYear === periodYear);

  const remainingMinutes = live.reduce((sum, row) => sum + row.minutes, 0);

  const grantedMinutes = live
    .filter((row) => isGrantedKind(row.kind))
    .reduce((sum, row) => sum + row.minutes, 0);

  let takenDebit = 0;
  let scheduledDebit = 0;
  for (const row of live) {
    if (row.kind !== "usage") continue;
    if (row.effectiveOn <= asOf) takenDebit += row.minutes;
    else scheduledDebit += row.minutes;
  }
  // usage rows are stored as negative minutes so remaining can be a single SUM
  const takenMinutes = takenDebit === 0 ? 0 : -takenDebit;
  const scheduledMinutes = scheduledDebit === 0 ? 0 : -scheduledDebit;

  const { yearStart, yearEnd } = calendarYearBounds(periodYear);
  const requestedMinutes = input.pendingEntries
    .filter(
      (entry) =>
        entry.status === "pending" &&
        entry.startDate <= yearEnd &&
        entry.endDate >= yearStart,
    )
    .reduce((sum, entry) => sum + entry.totalMinutes, 0);

  return {
    grantedMinutes,
    takenMinutes,
    scheduledMinutes,
    requestedMinutes,
    remainingMinutes,
    availableMinutes: remainingMinutes - requestedMinutes,
    asOf: new Date(`${asOf}T00:00:00.000Z`),
  };
}

export async function getOrgTimeZone(db: LedgerDb, employeeId: string): Promise<string> {
  const rows = await db
    .select({ timezone: organizations.timezone })
    .from(employees)
    .innerJoin(organizations, eq(employees.orgId, organizations.id))
    .where(eq(employees.id, employeeId));
  const row = rows[0];
  if (!row) {
    throw new Error(`employee not found: ${employeeId}`);
  }
  return row.timezone;
}

export async function getBalance(
  db: LedgerDb,
  input: {
    employeeId: string;
    leaveTypeId: string;
    asOf: Date | string;
    timeZone?: string;
  },
): Promise<Balance> {
  const timeZone = input.timeZone ?? (await getOrgTimeZone(db, input.employeeId));
  const asOf = asOfDateString(input.asOf, timeZone);
  const periodYear = periodYearFromAsOf(asOf, timeZone);

  const rows = await db
    .select({
      kind: ledgerEntries.kind,
      minutes: ledgerEntries.minutes,
      effectiveOn: ledgerEntries.effectiveOn,
      periodYear: ledgerEntries.periodYear,
      reversedAt: ledgerEntries.reversedAt,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.employeeId, input.employeeId),
        eq(ledgerEntries.leaveTypeId, input.leaveTypeId),
        eq(ledgerEntries.periodYear, periodYear),
        isNull(ledgerEntries.reversedAt),
        ne(ledgerEntries.kind, "reversal"),
      ),
    );

  const pending = await db
    .select({
      status: leaveEntries.status,
      totalMinutes: leaveEntries.totalMinutes,
      startDate: leaveEntries.startDate,
      endDate: leaveEntries.endDate,
    })
    .from(leaveEntries)
    .where(
      and(
        eq(leaveEntries.employeeId, input.employeeId),
        eq(leaveEntries.leaveTypeId, input.leaveTypeId),
        eq(leaveEntries.status, "pending"),
      ),
    );

  return computeBalance({
    rows,
    pendingEntries: pending,
    asOf,
    timeZone,
    periodYear,
  });
}
