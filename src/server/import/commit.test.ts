import { describe, expect, it } from "vitest";
import { MemoryLedger } from "@/server/ledger/memory";
import { IMPORT_OPENING_REASON } from "./csv";
import {
  commitImport,
  reverseImportBatch,
  type ImportCommitStore,
  type ImportBatchRecord,
} from "./commit";
import type { ImportWorld, PlannedHistoricalEntry } from "./dry-run";

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VACATION = "11111111-1111-4111-8111-111111111111";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const world: ImportWorld = {
  employees: [
    {
      id: ADA,
      email: "ada@example.com",
      name: "Ada",
      startDate: "2026-01-15",
      workdayMinutes: 480,
      orgWorkdayMinutes: 480,
      weekendDays: [6, 7],
    },
  ],
  leaveTypes: [
    { id: VACATION, code: "vacation_unpaid", name: "Vacation / Unpaid", consumesBalance: true },
  ],
  policies: [{ leaveTypeId: VACATION, grantMode: "periodic", grantMinutes: null }],
  ledger: [],
  holidays: [],
  plannedFirstYearGrants: [],
};

function memoryStore(): ImportCommitStore & {
  ledger: MemoryLedger;
  batches: ImportBatchRecord[];
  entries: PlannedHistoricalEntry[];
} {
  const ledger = new MemoryLedger();
  const batches: ImportBatchRecord[] = [];
  const entries: PlannedHistoricalEntry[] = [];
  return {
    ledger,
    batches,
    entries,
    loadWorld: async () => ({
      ...world,
      ledger: ledger.rows.map((row) => ({
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        kind: row.kind,
        minutes: row.minutes,
        effectiveOn: row.effectiveOn,
        periodYear: row.periodYear,
        reversedAt: row.reversedAt,
        reason: row.reason,
      })),
    }),
    listBatches: async () => batches,
    commitPlan: async (input) => {
      const batch: ImportBatchRecord = {
        id: crypto.randomUUID(),
        orgId: input.orgId,
        kind: input.kind,
        filename: input.filename,
        createdBy: input.actorId,
        createdAt: input.now,
        reversedAt: null,
      };
      batches.push(batch);
      for (const post of input.posts) {
        expect(post.kind).not.toBe("grant_lump");
        ledger.post({
          employeeId: post.employeeId,
          leaveTypeId: post.leaveTypeId,
          kind: post.kind,
          minutes: post.minutes,
          effectiveOn: post.effectiveOn,
          periodYear: post.periodYear,
          importBatchId: batch.id,
          reason: post.reason,
          createdBy: input.actorId,
          createdAt: input.now,
        });
      }
      entries.push(...input.entries);
      return batch;
    },
    reverseBatch: async (input) => {
      const batch = batches.find((row) => row.id === input.batchId && row.orgId === input.orgId);
      if (!batch) return { ok: false, status: 404, error: "import batch not found" };
      if (batch.reversedAt) return { ok: false, status: 409, error: "import batch already reversed" };
      let reversedLedger = 0;
      for (const row of [...ledger.rows]) {
        if (row.importBatchId === input.batchId && row.reversedAt == null && row.kind !== "reversal") {
          ledger.reverse(row.id, input.actorId, "import: reverse batch");
          reversedLedger += 1;
        }
      }
      batch.reversedAt = input.now;
      return { ok: true, batch, reversedLedger, cancelledEntries: entries.length };
    },
  };
}

describe("commitImport / reverse", () => {
  it("commits opening remaining as adjustment and reverses via reversal rows", async () => {
    const store = memoryStore();
    const csv = [
      "email,leave_type,as_of,remaining_hours",
      "ada@example.com,vacation_unpaid,2026-03-01,8.00",
    ].join("\n");
    const committed = await commitImport(
      {
        orgId: "org-1",
        actor: { id: ADMIN, role: "admin" },
        kind: "opening",
        csv,
        map: {
          email: "email",
          leave_type: "leave_type",
          as_of: "as_of",
          remaining_hours: "remaining_hours",
        },
        filename: "balances.csv",
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(store.ledger.rows).toHaveLength(1);
    expect(store.ledger.rows[0]).toMatchObject({
      kind: "adjustment",
      minutes: 480,
      reason: IMPORT_OPENING_REASON,
      importBatchId: committed.batch.id,
    });
    expect(store.ledger.rows.some((row) => row.kind === "grant_lump")).toBe(false);

    const reversed = await reverseImportBatch(
      { orgId: "org-1", batchId: committed.batch.id, actor: { id: ADMIN, role: "admin" } },
      store,
      { writeAudit: async () => {} },
    );
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(reversed.reversedLedger).toBe(1);
    expect(store.ledger.rows[0]?.reversedAt).not.toBeNull();
    expect(store.ledger.rows.some((row) => row.kind === "reversal")).toBe(true);
    expect(store.ledger.balance("2026-03-01", { employeeId: ADA, leaveTypeId: VACATION }).remainingMinutes).toBe(
      0,
    );
  });

  it("does not commit when dry-run fails", async () => {
    const store = memoryStore();
    const result = await commitImport(
      {
        orgId: "org-1",
        actor: { id: ADMIN, role: "admin" },
        kind: "opening",
        csv: "email,leave_type,as_of,remaining_hours\nmissing@x.com,vacation_unpaid,2026-01-01,8",
        map: {
          email: "email",
          leave_type: "leave_type",
          as_of: "as_of",
          remaining_hours: "remaining_hours",
        },
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(result.ok).toBe(false);
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.batches).toHaveLength(0);
  });
});
