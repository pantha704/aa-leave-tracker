import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  employees,
  holidays,
  importBatches,
  leaveDays,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  policies,
  policyAssignments,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getDb } from "@/server/db";
import type { LedgerKind } from "@/server/ledger/balance";
import {
  acquireEmployeeLock,
  prepareLedgerInsert,
  prepareReversal,
  type LedgerTx,
  type PostLedgerInput,
} from "@/server/ledger/post";
import type { AuthzActor } from "@/server/authz";
import {
  dryRunImport,
  planFirstYearSickGrants,
  type DryRunOptions,
  type DryRunResult,
  type ImportWorld,
  type PlannedHistoricalEntry,
  type PlannedLedgerPost,
} from "./dry-run";
import type { ColumnMap, ImportKind } from "./csv";

export type ImportBatchRecord = {
  id: string;
  orgId: string;
  kind: string;
  filename: string | null;
  createdBy: string;
  createdAt: Date;
  reversedAt: Date | null;
};

export type CommitImportInput = {
  orgId: string;
  actor: AuthzActor;
  kind: ImportKind;
  csv: string;
  map: ColumnMap;
  filename?: string | null;
};

export type CommitImportResult =
  | {
      ok: true;
      batch: ImportBatchRecord;
      dryRun: DryRunResult;
      posted: number;
      entries: number;
    }
  | {
      ok: false;
      dryRun: DryRunResult;
    };

export type ReverseImportResult =
  | { ok: true; batch: ImportBatchRecord; reversedLedger: number; cancelledEntries: number }
  | { ok: false; error: string; status: 404 | 409 };

export type ImportCommitStore = {
  loadWorld: (orgId: string) => Promise<ImportWorld>;
  commitPlan: (input: {
    orgId: string;
    actorId: string;
    kind: ImportKind;
    filename: string | null;
    posts: PlannedLedgerPost[];
    entries: PlannedHistoricalEntry[];
    now: Date;
  }) => Promise<ImportBatchRecord>;
  reverseBatch: (input: {
    orgId: string;
    batchId: string;
    actorId: string;
    now: Date;
  }) => Promise<ReverseImportResult>;
  listBatches: (orgId: string) => Promise<ImportBatchRecord[]>;
};

export async function previewImport(
  orgId: string,
  kind: ImportKind,
  csv: string,
  map: ColumnMap,
  store: ImportCommitStore,
  options: DryRunOptions = {},
): Promise<DryRunResult> {
  const world = await store.loadWorld(orgId);
  return dryRunImport(csv, kind, map, world, options);
}

export async function commitImport(
  input: CommitImportInput,
  store: ImportCommitStore,
  options: DryRunOptions & { writeAudit?: AuditWriter; now?: Date } = {},
): Promise<CommitImportResult> {
  const dryRun = await previewImport(input.orgId, input.kind, input.csv, input.map, store, options);
  if (!dryRun.ok) {
    return { ok: false, dryRun };
  }

  const now = options.now ?? new Date();
  const batch = await store.commitPlan({
    orgId: input.orgId,
    actorId: input.actor.id,
    kind: input.kind,
    filename: input.filename ?? null,
    posts: dryRun.posts,
    entries: dryRun.entries,
    now,
  });

  await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
    actorId: input.actor.id,
    action: "import.commit",
    entityType: "import_batch",
    entityId: batch.id,
    after: {
      kind: input.kind,
      posted: dryRun.posts.length,
      entries: dryRun.entries.length,
      filename: input.filename ?? null,
    },
  });

  return {
    ok: true,
    batch,
    dryRun,
    posted: dryRun.posts.length,
    entries: dryRun.entries.length,
  };
}

export async function reverseImportBatch(
  input: { orgId: string; batchId: string; actor: AuthzActor },
  store: ImportCommitStore,
  options: { writeAudit?: AuditWriter; now?: Date } = {},
): Promise<ReverseImportResult> {
  const result = await store.reverseBatch({
    orgId: input.orgId,
    batchId: input.batchId,
    actorId: input.actor.id,
    now: options.now ?? new Date(),
  });
  if (!result.ok) return result;

  await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
    actorId: input.actor.id,
    action: "import.reverse",
    entityType: "import_batch",
    entityId: input.batchId,
    after: {
      reversedLedger: result.reversedLedger,
      cancelledEntries: result.cancelledEntries,
    },
  });
  return result;
}

function toBatch(row: typeof importBatches.$inferSelect): ImportBatchRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    filename: row.filename,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    reversedAt: row.reversedAt,
  };
}

export const dbImportStore: ImportCommitStore = {
  async loadWorld(orgId) {
    const db = getDb();
    const people = await db
      .select({
        id: employees.id,
        email: employees.email,
        name: employees.name,
        startDate: employees.startDate,
        workdayMinutes: employees.workdayMinutes,
      })
      .from(employees)
      .where(eq(employees.orgId, orgId));

    const org = await db
      .select({
        standardWorkdayMinutes: organizations.standardWorkdayMinutes,
        weekendDays: organizations.weekendDays,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const orgWorkday = org[0]?.standardWorkdayMinutes ?? 480;
    const weekendDays = org[0]?.weekendDays ?? [6, 7];

    const types = await db
      .select({
        id: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        consumesBalance: leaveTypes.consumesBalance,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.orgId, orgId));

    const policyRows = await db
      .select({
        leaveTypeId: policies.leaveTypeId,
        grantMode: policies.grantMode,
        grantMinutes: policies.grantMinutes,
      })
      .from(policies)
      .innerJoin(policyAssignments, eq(policyAssignments.policyId, policies.id))
      .innerJoin(employees, eq(employees.id, policyAssignments.employeeId))
      .where(eq(employees.orgId, orgId));

    const employeeIds = people.map((row) => row.id);
    const ledger =
      employeeIds.length === 0
        ? []
        : await db
            .select({
              kind: ledgerEntries.kind,
              minutes: ledgerEntries.minutes,
              effectiveOn: ledgerEntries.effectiveOn,
              periodYear: ledgerEntries.periodYear,
              reversedAt: ledgerEntries.reversedAt,
              employeeId: ledgerEntries.employeeId,
              leaveTypeId: ledgerEntries.leaveTypeId,
              reason: ledgerEntries.reason,
            })
            .from(ledgerEntries)
            .where(inArray(ledgerEntries.employeeId, employeeIds));

    const holidayRows = await db
      .select({ onDate: holidays.onDate })
      .from(holidays)
      .where(eq(holidays.orgId, orgId));

    const worldBase = {
      employees: people.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        startDate: row.startDate,
        workdayMinutes: row.workdayMinutes,
        orgWorkdayMinutes: orgWorkday,
        weekendDays,
      })),
      leaveTypes: types,
      policies: policyRows,
      ledger,
      holidays: holidayRows,
    };

    return {
      ...worldBase,
      plannedFirstYearGrants: planFirstYearSickGrants(worldBase),
    };
  },

  async listBatches(orgId) {
    const rows = await getDb()
      .select()
      .from(importBatches)
      .where(eq(importBatches.orgId, orgId))
      .orderBy(desc(importBatches.createdAt));
    return rows.map(toBatch);
  },

  async commitPlan(input) {
    const db = getDb();
    const employeeIds = [
      ...new Set([
        ...input.posts.map((post) => post.employeeId),
        ...input.entries.map((entry) => entry.employeeId),
      ]),
    ];

    return db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({
          orgId: input.orgId,
          kind: input.kind,
          filename: input.filename,
          createdBy: input.actorId,
          createdAt: input.now,
        })
        .returning();
      if (!batch) throw new Error("import batch insert returned no row");

      const entryIds: string[] = [];
      for (const planned of input.entries) {
        const entryId = crypto.randomUUID();
        entryIds.push(entryId);
        await tx.insert(leaveEntries).values({
          id: entryId,
          employeeId: planned.employeeId,
          leaveTypeId: planned.leaveTypeId,
          intent: planned.intent,
          status: "approved",
          immutableAt: input.now,
          startDate: planned.startDate,
          endDate: planned.endDate,
          portion: planned.portion,
          customMinutes: planned.customMinutes,
          totalMinutes: planned.totalMinutes,
          note: planned.note,
          importBatchId: batch.id,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        if (planned.days.length > 0) {
          await tx.insert(leaveDays).values(
            planned.days.map((day) => ({
              id: crypto.randomUUID(),
              leaveEntryId: entryId,
              employeeId: planned.employeeId,
              onDate: day.onDate,
              minutes: day.minutes,
              portion: day.portion,
              consumesBalance: day.consumesBalance,
              slotActive: true,
            })),
          );
        }
      }

      const usageByLine = new Map<number, string>();
      input.entries.forEach((entry, index) => {
        usageByLine.set(entry.line, entryIds[index] ?? "");
      });

      const postsByEmployee = new Map<string, PlannedLedgerPost[]>();
      for (const post of input.posts) {
        const list = postsByEmployee.get(post.employeeId) ?? [];
        list.push(post);
        postsByEmployee.set(post.employeeId, list);
      }

      for (const employeeId of employeeIds) {
        const locked = tx as unknown as LedgerTx;
        await acquireEmployeeLock(locked, employeeId);
        const posts = postsByEmployee.get(employeeId) ?? [];
        for (const post of posts) {
          const values: PostLedgerInput = {
            employeeId: post.employeeId,
            leaveTypeId: post.leaveTypeId,
            kind: post.kind,
            minutes: post.minutes,
            effectiveOn: post.effectiveOn,
            periodYear: post.periodYear,
            importBatchId: batch.id,
            leaveEntryId: post.kind === "usage" ? (usageByLine.get(post.line) ?? null) : null,
            reason: post.reason,
            createdBy: input.actorId,
            createdAt: input.now,
          };
          await locked.insert(ledgerEntries).values(prepareLedgerInsert(values));
        }
      }

      return toBatch(batch);
    });
  },

  async reverseBatch(input) {
    const db = getDb();
    const [batch] = await db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, input.batchId), eq(importBatches.orgId, input.orgId)))
      .limit(1);
    if (!batch) return { ok: false, status: 404, error: "import batch not found" };
    if (batch.reversedAt) return { ok: false, status: 409, error: "import batch already reversed" };

    return db.transaction(async (tx) => {
      const ledgerRows = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.importBatchId, input.batchId), isNull(ledgerEntries.reversedAt)));

      const byEmployee = new Map<string, typeof ledgerRows>();
      for (const row of ledgerRows) {
        if (row.kind === "reversal") continue;
        const list = byEmployee.get(row.employeeId) ?? [];
        list.push(row);
        byEmployee.set(row.employeeId, list);
      }

      let reversedLedger = 0;
      const locked = tx as unknown as LedgerTx;
      for (const [employeeId, rows] of byEmployee) {
        await acquireEmployeeLock(locked, employeeId);
        for (const original of rows) {
          const prepared = prepareReversal(
            { ...original, kind: original.kind as LedgerKind },
            {
              id: original.id,
              createdBy: input.actorId,
              reason: "import: reverse batch",
              createdAt: input.now,
            },
          );
          const updated = await locked
            .update(ledgerEntries)
            .set({ reversedAt: prepared.reversedAt })
            .where(and(eq(ledgerEntries.id, original.id), isNull(ledgerEntries.reversedAt)))
            .returning();
          if (updated[0]) {
            await locked.insert(ledgerEntries).values({
              ...prepared.reversal,
              importBatchId: input.batchId,
            });
            reversedLedger += 1;
          }
        }
      }

      const cancelled = await tx
        .update(leaveEntries)
        .set({
          status: "cancelled",
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(leaveEntries.importBatchId, input.batchId))
        .returning({ id: leaveEntries.id });

      const cancelledIds = cancelled.map((row) => row.id);
      if (cancelledIds.length > 0) {
        await tx
          .update(leaveDays)
          .set({ slotActive: false })
          .where(inArray(leaveDays.leaveEntryId, cancelledIds));
      }

      const [next] = await tx
        .update(importBatches)
        .set({ reversedAt: input.now })
        .where(and(eq(importBatches.id, input.batchId), isNull(importBatches.reversedAt)))
        .returning();
      if (!next) return { ok: false as const, status: 409 as const, error: "import batch already reversed" };

      return {
        ok: true as const,
        batch: toBatch(next),
        reversedLedger,
        cancelledEntries: cancelled.length,
      };
    });
  },
};
