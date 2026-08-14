import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { employees, leaveDays, leaveEntries, ledgerEntries, organizations } from "@/db/schema";

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
  /** Org-local civil date. Never a UTC midnight Date (west-of-UTC zones shift the day). */
  asOf: string;
};

export type LedgerSumRow = {
  kind: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  reversedAt: Date | null;
  employeeId?: string;
  leaveTypeId?: string;
};

export type PendingDayMinutes = {
  onDate: string;
  minutes: number;
};

export type PendingEntrySumRow = {
  status: string;
  totalMinutes: number;
  startDate: string;
  endDate: string;
  employeeId?: string;
  leaveTypeId?: string;
  days?: PendingDayMinutes[];
};

export type LedgerDb = PostgresJsDatabase<Record<string, unknown>>;

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function requireIsoDate(value: string, label = "date"): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

export function addIsoDays(isoDate: string, days: number): string {
  const [, year, month, day] = requireIsoDate(isoDate).match(ISO_DATE)!;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

export function inclusiveIsoDates(startDate: string, endDate: string): string[] {
  const start = requireIsoDate(startDate, "startDate");
  const end = requireIsoDate(endDate, "endDate");
  if (end < start) {
    throw new Error("endDate must be on or after startDate");
  }
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addIsoDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

export function allocateMinutesAcrossDays(dates: readonly string[], totalMinutes: number): PendingDayMinutes[] {
  if (!Number.isInteger(totalMinutes)) {
    throw new Error("minutes must be an integer");
  }
  if (dates.length === 0) return [];
  const base = Math.trunc(totalMinutes / dates.length);
  const remainder = totalMinutes - base * dates.length;
  return dates.map((onDate, index) => ({
    onDate,
    minutes: base + (index >= dates.length - remainder ? 1 : 0),
  }));
}

export function isLiveLedgerRow(row: Pick<LedgerSumRow, "reversedAt" | "kind">): boolean {
  return row.reversedAt == null && row.kind !== "reversal";
}

export function isGrantedKind(kind: string): kind is GrantedKind {
  return (GRANTED_KINDS as readonly string[]).includes(kind);
}

/** Calendar YYYY-MM-DD in an IANA zone. Bare dates are already org-local. */
export function asOfDateString(asOf: Date | string, timeZone: string): string {
  if (typeof asOf === "string" && ISO_DATE.test(asOf)) {
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

export function calendarYearBounds(periodYear: number): { yearStart: string; yearEnd: string } {
  return { yearStart: `${periodYear}-01-01`, yearEnd: `${periodYear}-12-31` };
}

/** Pending requested minutes that fall on days in periodYear only. */
export function pendingMinutesInPeriod(entry: PendingEntrySumRow, periodYear: number): number {
  if (entry.status !== "pending") return 0;
  const { yearStart, yearEnd } = calendarYearBounds(periodYear);
  const days =
    entry.days && entry.days.length > 0
      ? entry.days
      : allocateMinutesAcrossDays(inclusiveIsoDates(entry.startDate, entry.endDate), entry.totalMinutes);
  return days
    .filter((day) => day.onDate >= yearStart && day.onDate <= yearEnd)
    .reduce((sum, day) => sum + day.minutes, 0);
}

/**
 * Four-bucket SUM. remainingMinutes is only this: SUM(live ledger minutes in period).
 * Live = reversed_at IS NULL AND kind <> 'reversal'. Includes forfeit.
 */
export function computeBalance(input: {
  rows: readonly LedgerSumRow[];
  pendingEntries: readonly PendingEntrySumRow[];
  asOf: Date | string;
  timeZone: string;
  periodYear?: number;
  employeeId?: string;
  leaveTypeId?: string;
}): Balance {
  const asOf = asOfDateString(input.asOf, input.timeZone);
  const periodYear = input.periodYear ?? periodYearFromAsOf(asOf, input.timeZone);
  const scopedRows = input.rows.filter((row) => {
    if (input.employeeId && row.employeeId && row.employeeId !== input.employeeId) return false;
    if (input.leaveTypeId && row.leaveTypeId && row.leaveTypeId !== input.leaveTypeId) return false;
    return true;
  });
  const live = scopedRows.filter((row) => isLiveLedgerRow(row) && row.periodYear === periodYear);

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

  const requestedMinutes = input.pendingEntries
    .filter((entry) => {
      if (entry.status !== "pending") return false;
      if (input.employeeId && entry.employeeId && entry.employeeId !== input.employeeId) return false;
      if (input.leaveTypeId && entry.leaveTypeId && entry.leaveTypeId !== input.leaveTypeId) return false;
      return true;
    })
    .reduce((sum, entry) => sum + pendingMinutesInPeriod(entry, periodYear), 0);

  return {
    grantedMinutes,
    takenMinutes,
    scheduledMinutes,
    requestedMinutes,
    remainingMinutes,
    availableMinutes: remainingMinutes - requestedMinutes,
    asOf,
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
      employeeId: ledgerEntries.employeeId,
      leaveTypeId: ledgerEntries.leaveTypeId,
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
      id: leaveEntries.id,
      status: leaveEntries.status,
      totalMinutes: leaveEntries.totalMinutes,
      startDate: leaveEntries.startDate,
      endDate: leaveEntries.endDate,
      employeeId: leaveEntries.employeeId,
      leaveTypeId: leaveEntries.leaveTypeId,
    })
    .from(leaveEntries)
    .where(
      and(
        eq(leaveEntries.employeeId, input.employeeId),
        eq(leaveEntries.leaveTypeId, input.leaveTypeId),
        eq(leaveEntries.status, "pending"),
      ),
    );

  const pendingIds = pending.map((entry) => entry.id);
  const dayRows =
    pendingIds.length === 0
      ? []
      : await db
          .select({
            leaveEntryId: leaveDays.leaveEntryId,
            onDate: leaveDays.onDate,
            minutes: leaveDays.minutes,
          })
          .from(leaveDays)
          .where(inArray(leaveDays.leaveEntryId, pendingIds));

  const daysByEntry = new Map<string, PendingDayMinutes[]>();
  for (const day of dayRows) {
    const list = daysByEntry.get(day.leaveEntryId) ?? [];
    list.push({ onDate: day.onDate, minutes: day.minutes });
    daysByEntry.set(day.leaveEntryId, list);
  }

  return computeBalance({
    rows,
    pendingEntries: pending.map((entry) => ({
      status: entry.status,
      totalMinutes: entry.totalMinutes,
      startDate: entry.startDate,
      endDate: entry.endDate,
      employeeId: entry.employeeId,
      leaveTypeId: entry.leaveTypeId,
      days: daysByEntry.get(entry.id),
    })),
    asOf,
    timeZone,
    periodYear,
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
  });
}
