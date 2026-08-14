import { computeBalance, type Balance, type PendingEntrySumRow } from "./balance";
import {
  assertLiveGrantAvailable,
  prepareLedgerInsert,
  prepareReversal,
  type PostLedgerInput,
  type PreparedLedgerInsert,
} from "./post";

export type MemoryLedgerRow = PreparedLedgerInsert & { id: string };

export type MemoryBalanceScope = {
  employeeId: string;
  leaveTypeId: string;
  timeZone?: string;
};

/** In-memory ledger that applies the same prepare/unique rules as SQL posts. */
export class MemoryLedger {
  readonly rows: MemoryLedgerRow[] = [];
  pending: PendingEntrySumRow[] = [];

  post(input: PostLedgerInput): MemoryLedgerRow {
    const prepared = prepareLedgerInsert(input);
    assertLiveGrantAvailable(this.rows, prepared);
    const row: MemoryLedgerRow = { ...prepared, id: input.id ?? crypto.randomUUID() };
    this.rows.push(row);
    return row;
  }

  reverse(id: string, createdBy: string, reason?: string | null): MemoryLedgerRow {
    const original = this.rows.find((row) => row.id === id);
    if (!original) {
      throw new Error(`ledger row not found: ${id}`);
    }
    const { reversedAt, reversal } = prepareReversal(original, { id, createdBy, reason });
    original.reversedAt = reversedAt;
    const row: MemoryLedgerRow = { ...reversal, id: crypto.randomUUID() };
    this.rows.push(row);
    return row;
  }

  balance(asOf: string, scope: MemoryBalanceScope): Balance {
    return computeBalance({
      rows: this.rows,
      pendingEntries: this.pending,
      asOf,
      timeZone: scope.timeZone ?? "UTC",
      employeeId: scope.employeeId,
      leaveTypeId: scope.leaveTypeId,
    });
  }
}

export class SerialLock {
  private tails = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      key,
      prev.then(() => next),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
