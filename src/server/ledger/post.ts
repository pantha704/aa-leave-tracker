import { and, eq, isNull, sql } from "drizzle-orm";
import { ledgerEntries } from "@/db/schema";
import type { LedgerDb, LedgerKind } from "./balance";

const DEBIT_KINDS = new Set<LedgerKind>(["usage", "forfeit"]);
const GRANT_ONCE_KINDS = new Set<LedgerKind>(["grant_lump", "accrual", "carryover"]);

export type PostableKind = Exclude<LedgerKind, "reversal">;

export type PostLedgerInput = {
  employeeId: string;
  leaveTypeId: string;
  kind: PostableKind;
  minutes: number;
  effectiveOn: string;
  periodYear?: number;
  leaveEntryId?: string | null;
  leaveDayId?: string | null;
  importBatchId?: string | null;
  reason?: string | null;
  createdBy: string;
  createdAt?: Date;
  id?: string;
};

export type PreparedLedgerInsert = {
  id?: string;
  employeeId: string;
  leaveTypeId: string;
  kind: LedgerKind;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  leaveEntryId: string | null;
  leaveDayId: string | null;
  reversesId: string | null;
  reversedAt: Date | null;
  importBatchId: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
};

export type ReverseLedgerInput = {
  id: string;
  createdBy: string;
  reason?: string | null;
  createdAt?: Date;
};

export type LedgerRow = typeof ledgerEntries.$inferSelect;

export function requireIntegerMinutes(minutes: number): number {
  if (!Number.isInteger(minutes)) {
    throw new Error("minutes must be an integer");
  }
  return minutes;
}

/** usage/forfeit are debits so remaining can be SUM(live minutes). */
export function signedLedgerMinutes(kind: LedgerKind, minutes: number): number {
  const value = requireIntegerMinutes(minutes);
  if (DEBIT_KINDS.has(kind) && value > 0) {
    return -value;
  }
  return value;
}

export function periodYearForEffectiveOn(effectiveOn: string, periodYear?: number): number {
  if (periodYear !== undefined) {
    if (!Number.isInteger(periodYear)) {
      throw new Error("periodYear must be an integer");
    }
    return periodYear;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
    throw new Error("effectiveOn must be YYYY-MM-DD");
  }
  return Number(effectiveOn.slice(0, 4));
}

export function liveGrantOnceKey(row: {
  employeeId: string;
  leaveTypeId: string;
  kind: string;
  periodYear: number;
  effectiveOn: string;
  reversedAt: Date | null;
}): string | null {
  if (row.reversedAt != null) return null;
  if (!GRANT_ONCE_KINDS.has(row.kind as LedgerKind)) return null;
  return `${row.employeeId}\0${row.leaveTypeId}\0${row.kind}\0${row.periodYear}\0${row.effectiveOn}`;
}

export function assertLiveGrantAvailable(
  existing: readonly {
    employeeId: string;
    leaveTypeId: string;
    kind: string;
    periodYear: number;
    effectiveOn: string;
    reversedAt: Date | null;
  }[],
  next: {
    employeeId: string;
    leaveTypeId: string;
    kind: string;
    periodYear: number;
    effectiveOn: string;
    reversedAt: Date | null;
  },
): void {
  const key = liveGrantOnceKey(next);
  if (!key) return;
  for (const row of existing) {
    if (liveGrantOnceKey(row) === key) {
      throw new Error("live grant already exists for employee/type/kind/period/effective_on");
    }
  }
}

export function prepareLedgerInsert(input: PostLedgerInput): PreparedLedgerInsert {
  const createdAt = input.createdAt ?? new Date();
  return {
    ...(input.id ? { id: input.id } : {}),
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    kind: input.kind,
    minutes: signedLedgerMinutes(input.kind, input.minutes),
    effectiveOn: input.effectiveOn,
    periodYear: periodYearForEffectiveOn(input.effectiveOn, input.periodYear),
    leaveEntryId: input.leaveEntryId ?? null,
    leaveDayId: input.leaveDayId ?? null,
    reversesId: null,
    reversedAt: null,
    importBatchId: input.importBatchId ?? null,
    reason: input.reason ?? null,
    createdBy: input.createdBy,
    createdAt,
  };
}

export function prepareReversal(
  original: PreparedLedgerInsert & { id: string },
  input: ReverseLedgerInput,
): { reversedAt: Date; reversal: PreparedLedgerInsert } {
  if (original.reversedAt != null) {
    throw new Error("ledger row already reversed");
  }
  if (original.kind === "reversal") {
    throw new Error("cannot reverse a reversal");
  }
  const reversedAt = input.createdAt ?? new Date();
  return {
    reversedAt,
    reversal: {
      employeeId: original.employeeId,
      leaveTypeId: original.leaveTypeId,
      kind: "reversal",
      minutes: -original.minutes,
      effectiveOn: original.effectiveOn,
      periodYear: original.periodYear,
      leaveEntryId: original.leaveEntryId,
      leaveDayId: original.leaveDayId,
      reversesId: original.id,
      reversedAt: null,
      importBatchId: original.importBatchId,
      reason: input.reason ?? null,
      createdBy: input.createdBy,
      createdAt: reversedAt,
    },
  };
}

/** Normative lock: FOR UPDATE on an empty ledger locks nothing. */
export function employeeAdvisoryLockQuery(employeeId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${employeeId}::text, 0))`;
}

export async function acquireEmployeeLock(tx: LedgerDb, employeeId: string): Promise<void> {
  await tx.execute(employeeAdvisoryLockQuery(employeeId));
}

async function inEmployeeLock<T>(
  db: LedgerDb,
  employeeId: string,
  fn: (tx: LedgerDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireEmployeeLock(tx as unknown as LedgerDb, employeeId);
    return fn(tx as unknown as LedgerDb);
  });
}

export async function postLedgerEntry(db: LedgerDb, input: PostLedgerInput): Promise<LedgerRow> {
  const values = prepareLedgerInsert(input);
  return inEmployeeLock(db, input.employeeId, async (tx) => {
    const inserted = await tx.insert(ledgerEntries).values(values).returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("ledger insert returned no row");
    }
    return row;
  });
}

export async function reverseLedgerEntry(
  db: LedgerDb,
  input: ReverseLedgerInput,
): Promise<{ original: LedgerRow; reversal: LedgerRow }> {
  return db.transaction(async (tx) => {
    const found = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, input.id));
    const original = found[0];
    if (!original) {
      throw new Error(`ledger row not found: ${input.id}`);
    }

    await acquireEmployeeLock(tx as unknown as LedgerDb, original.employeeId);

    const prepared = prepareReversal(
      {
        ...original,
        kind: original.kind as LedgerKind,
      },
      input,
    );

    const updated = await tx
      .update(ledgerEntries)
      .set({ reversedAt: prepared.reversedAt })
      .where(and(eq(ledgerEntries.id, original.id), isNull(ledgerEntries.reversedAt)))
      .returning();
    const reversedOriginal = updated[0];
    if (!reversedOriginal) {
      throw new Error("ledger row already reversed");
    }

    const inserted = await tx.insert(ledgerEntries).values(prepared.reversal).returning();
    const reversal = inserted[0];
    if (!reversal) {
      throw new Error("reversal insert returned no row");
    }
    return { original: reversedOriginal, reversal };
  });
}

export async function withEmployeeLock<T>(
  db: LedgerDb,
  employeeId: string,
  fn: (tx: LedgerDb) => Promise<T>,
): Promise<T> {
  return inEmployeeLock(db, employeeId, fn);
}

export async function postLedgerEntryInTx(tx: LedgerDb, input: PostLedgerInput): Promise<LedgerRow> {
  await acquireEmployeeLock(tx, input.employeeId);
  const values = prepareLedgerInsert(input);
  const inserted = await tx.insert(ledgerEntries).values(values).returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("ledger insert returned no row");
  }
  return row;
}
