import { describe, expect, it } from "vitest";
import { MemoryLedger } from "@/server/ledger/memory";
import { IMPORT_OPENING_REASON } from "./csv";
import {
  commitImport,
  reverseImportBatch,
  type ImportCommitStore,
  type ImportBatchRecord,
} from "./commit";
import { dryRunImport, type ImportWorld, type PlannedHistoricalEntry } from "./dry-run";

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VACATION = "11111111-1111-4111-8111-111111111111";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseWorld(): ImportWorld {
  return {
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
    policies: [{ employeeId: ADA, leaveTypeId: VACATION, grantMode: "periodic", grantMinutes: null }],
    ledger: [],
    holidays: [],
    occupancy: [],
    plannedFirstYearGrants: [],
  };
}

function memoryStore(): ImportCommitStore & {
  ledger: MemoryLedger;
  batches: ImportBatchRecord[];
  entries: PlannedHistoricalEntry[];
} {
  const ledger = new MemoryLedger();
  const batches: ImportBatchRecord[] = [];
  const entries: PlannedHistoricalEntry[] = [];
  const loadWorld = async (): Promise<ImportWorld> => ({
    ...baseWorld(),
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
  });
  return {
    ledger,
    batches,
    entries,
    loadWorld,
    isAppReadonly: async () => false,
    listBatches: async () => batches,
    applyCommit: async (input) => {
      const first = dryRunImport(input.csv, input.kind, input.map, await loadWorld(), input.options);
      if (!first.ok) return { ok: false, dryRun: first };
      const dryRun = dryRunImport(input.csv, input.kind, input.map, await loadWorld(), input.options);
      if (!dryRun.ok) return { ok: false, dryRun };
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
      for (const post of dryRun.posts) {
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
      entries.push(...dryRun.entries);
      return { ok: true, batch, dryRun, posted: dryRun.posts.length, entries: dryRun.entries.length };
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

const openingMap = {
  email: "email",
  leave_type: "leave_type",
  as_of: "as_of",
  remaining_hours: "remaining_hours",
};

describe("commitImport / reverse", () => {
  it("commits opening remaining as sheet−app adjustment and reverses via reversal rows", async () => {
    const store = memoryStore();
    store.ledger.post({
      employeeId: ADA,
      leaveTypeId: VACATION,
      kind: "adjustment",
      minutes: 480,
      effectiveOn: "2026-01-01",
      createdBy: ADMIN,
    });
    const csv = [
      "email,leave_type,as_of,remaining_hours",
      "ada@example.com,vacation_unpaid,2026-03-01,10.00",
    ].join("\n");
    const committed = await commitImport(
      {
        orgId: "org-1",
        actor: { id: ADMIN, role: "admin" },
        kind: "opening",
        csv,
        map: openingMap,
        filename: "balances.csv",
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const imported = store.ledger.rows.filter((row) => row.importBatchId === committed.batch.id);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      kind: "adjustment",
      minutes: 120,
      reason: IMPORT_OPENING_REASON,
    });
    expect(store.ledger.balance("2026-03-01", { employeeId: ADA, leaveTypeId: VACATION }).remainingMinutes).toBe(
      600,
    );
    expect(store.ledger.rows.some((row) => row.kind === "grant_lump")).toBe(false);

    const again = await commitImport(
      {
        orgId: "org-1",
        actor: { id: ADMIN, role: "admin" },
        kind: "opening",
        csv,
        map: openingMap,
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(again.ok).toBe(false);

    const reversed = await reverseImportBatch(
      { orgId: "org-1", batchId: committed.batch.id, actor: { id: ADMIN, role: "admin" } },
      store,
      { writeAudit: async () => {} },
    );
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(reversed.reversedLedger).toBe(1);
    expect(imported[0]?.reversedAt).not.toBeNull();
    expect(store.ledger.rows.some((row) => row.kind === "reversal")).toBe(true);
    expect(store.ledger.balance("2026-03-01", { employeeId: ADA, leaveTypeId: VACATION }).remainingMinutes).toBe(
      480,
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
        map: openingMap,
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(result.ok).toBe(false);
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.batches).toHaveLength(0);
  });

  it("returns 423 when the app is readonly", async () => {
    const store = memoryStore();
    store.isAppReadonly = async () => true;
    const result = await commitImport(
      {
        orgId: "org-1",
        actor: { id: ADMIN, role: "admin" },
        kind: "opening",
        csv: [
          "email,leave_type,as_of,remaining_hours",
          "ada@example.com,vacation_unpaid,2026-03-01,10.00",
        ].join("\n"),
        map: openingMap,
      },
      store,
      { writeAudit: async () => {} },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 423,
      code: "APP_READONLY",
    });
    expect(store.batches).toHaveLength(0);
  });
});
