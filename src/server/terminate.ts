import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { employees, leaveDays, leaveEntries, ledgerEntries } from "@/db/schema";
import {
  isUuid,
  pgEmployeeStore,
  type AdminFail,
  type EmployeeIdentity,
} from "@/server/admin/employees";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { canAdmin, type AuthzActor } from "@/server/authz";
import { getDb } from "@/server/db";
import { buildExport, type BuildExportInput, type BuildExportResult } from "@/server/export";
import { parseIsoDate } from "@/server/holidays/csv";
import { type LedgerDb, type LedgerKind } from "@/server/ledger/balance";
import { prepareReversal, withEmployeeLock } from "@/server/ledger/post";
import { isInvalidDate, isInvalidText } from "@/server/pg-error";

export type TerminateInput = {
  endDate: string;
  reason: string;
};

export type TerminateResult = {
  employee: { id: string; endDate: string; active: false };
  cancelledPending: number;
  reversedUsage: number;
  lockedEntries: number;
  filename: string;
  downloadPath: string;
  csv: string;
};

export type TerminateStoreEntry = {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  immutableAt: Date | null;
  days: Array<{ onDate: string; slotActive: boolean }>;
};

export type TerminateStore = {
  withEmployeeLock: <T>(employeeId: string, fn: () => Promise<T>) => Promise<T>;
  getEmployee: (orgId: string, employeeId: string) => Promise<EmployeeIdentity | null>;
  markInactive: (employeeId: string, endDate: string) => Promise<void>;
  listEntries: (employeeId: string) => Promise<TerminateStoreEntry[]>;
  cancelEntry: (input: {
    id: string;
    actorId: string;
    now: Date;
    adminNote: string;
  }) => Promise<void>;
  deactivateDaysAfter: (leaveEntryId: string, endDate: string) => Promise<void>;
  reverseUsageAfter: (input: {
    leaveEntryId: string;
    endDate: string;
    createdBy: string;
    reason: string;
    createdAt: Date;
  }) => Promise<number>;
  lockRemainingEntries: (employeeId: string, at: Date) => Promise<number>;
};

export type TerminateOptions = {
  store?: TerminateStore;
  writeAudit?: AuditWriter;
  buildExport?: (input: BuildExportInput) => Promise<BuildExportResult>;
  now?: Date;
};

const dbAls = new AsyncLocalStorage<LedgerDb>();

function currentDb(): LedgerDb {
  return dbAls.getStore() ?? getDb();
}

function firstString(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const snake = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
  return record[key] ?? record[snake];
}

function writeInputError(err: unknown): AdminFail | null {
  if (isInvalidText(err)) return { ok: false, status: 404, error: "employee not found" };
  if (isInvalidDate(err)) return { ok: false, status: 400, error: "invalid date" };
  return null;
}

/** Jobs must skip inactive people and any grant/accrual with effective_on after end_date. */
export function shouldSkipGrantOrAccrual(
  employee: { active: boolean; endDate: string | null },
  effectiveOn: string,
): boolean {
  if (!employee.active) return true;
  return employee.endDate != null && effectiveOn > employee.endDate;
}

export function terminationCsvDownloadPath(employeeId: string, endDate: string): string {
  return `/api/admin/export/termination.csv?employeeId=${employeeId}&endDate=${endDate}`;
}

export function entryHasDayAfter(entry: { days: Array<{ onDate: string }> }, endDate: string): boolean {
  return entry.days.some((day) => day.onDate > endDate);
}

export function parseTerminateInput(raw: unknown):
  | { ok: true; value: TerminateInput }
  | { ok: false; error: string } {
  const endDateRaw = String(firstString(raw, "endDate") ?? "").trim();
  const reason = String(firstString(raw, "reason") ?? "").trim();
  const endDate = parseIsoDate(endDateRaw);
  if (!endDate) return { ok: false, error: "endDate must be YYYY-MM-DD" };
  if (!reason) return { ok: false, error: "reason is required" };
  return { ok: true, value: { endDate, reason } };
}

export function pgTerminateStore(db: ReturnType<typeof getDb> = getDb()): TerminateStore {
  const employeesStore = pgEmployeeStore(db);
  return {
    async withEmployeeLock(employeeId, fn) {
      return withEmployeeLock(dbAls.getStore() ?? db, employeeId, async (tx) => dbAls.run(tx, fn));
    },
    getEmployee(orgId, employeeId) {
      return employeesStore.getEmployee(orgId, employeeId);
    },
    async markInactive(employeeId, endDate) {
      await currentDb()
        .update(employees)
        .set({ endDate, active: false })
        .where(eq(employees.id, employeeId));
    },
    async listEntries(employeeId) {
      const dbNow = currentDb();
      const rows = await dbNow
        .select({
          id: leaveEntries.id,
          status: leaveEntries.status,
          startDate: leaveEntries.startDate,
          endDate: leaveEntries.endDate,
          immutableAt: leaveEntries.immutableAt,
        })
        .from(leaveEntries)
        .where(eq(leaveEntries.employeeId, employeeId));
      if (rows.length === 0) return [];
      const days = await dbNow
        .select({
          leaveEntryId: leaveDays.leaveEntryId,
          onDate: leaveDays.onDate,
          slotActive: leaveDays.slotActive,
        })
        .from(leaveDays)
        .where(inArray(leaveDays.leaveEntryId, rows.map((row) => row.id)));
      const byEntry = new Map<string, Array<{ onDate: string; slotActive: boolean }>>();
      for (const day of days) {
        const list = byEntry.get(day.leaveEntryId) ?? [];
        list.push({ onDate: day.onDate, slotActive: day.slotActive });
        byEntry.set(day.leaveEntryId, list);
      }
      return rows.map((row) => ({ ...row, days: byEntry.get(row.id) ?? [] }));
    },
    async cancelEntry(input) {
      const dbNow = currentDb();
      await dbNow
        .update(leaveEntries)
        .set({
          status: "cancelled",
          updatedBy: input.actorId,
          updatedAt: input.now,
          adminNote: input.adminNote,
        })
        .where(eq(leaveEntries.id, input.id));
      await dbNow.update(leaveDays).set({ slotActive: false }).where(eq(leaveDays.leaveEntryId, input.id));
    },
    async deactivateDaysAfter(leaveEntryId, endDate) {
      await currentDb()
        .update(leaveDays)
        .set({ slotActive: false })
        .where(and(eq(leaveDays.leaveEntryId, leaveEntryId), gt(leaveDays.onDate, endDate)));
    },
    async reverseUsageAfter(input) {
      const dbNow = currentDb();
      const rows = await dbNow
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.leaveEntryId, input.leaveEntryId),
            eq(ledgerEntries.kind, "usage"),
            isNull(ledgerEntries.reversedAt),
            gt(ledgerEntries.effectiveOn, input.endDate),
          ),
        );
      for (const original of rows) {
        const prepared = prepareReversal(
          { ...original, kind: original.kind as LedgerKind },
          {
            id: original.id,
            createdBy: input.createdBy,
            reason: input.reason,
            createdAt: input.createdAt,
          },
        );
        await dbNow
          .update(ledgerEntries)
          .set({ reversedAt: prepared.reversedAt })
          .where(and(eq(ledgerEntries.id, original.id), isNull(ledgerEntries.reversedAt)));
        await dbNow.insert(ledgerEntries).values(prepared.reversal);
      }
      return rows.length;
    },
    async lockRemainingEntries(employeeId, at) {
      const updated = await currentDb()
        .update(leaveEntries)
        .set({ immutableAt: at })
        .where(and(eq(leaveEntries.employeeId, employeeId), isNull(leaveEntries.immutableAt)))
        .returning({ id: leaveEntries.id });
      return updated.length;
    },
  };
}

export async function terminateEmployee(input: {
  actor: AuthzActor | null;
  orgId: string;
  employeeId: string;
  raw: unknown;
  store?: TerminateStore;
  writeAudit?: AuditWriter;
  buildExport?: (input: BuildExportInput) => Promise<BuildExportResult>;
  now?: Date;
}): Promise<{ ok: true } & TerminateResult | AdminFail> {
  if (!input.actor) return { ok: false, status: 401, error: "unauthenticated" };
  if (!canAdmin(input.actor)) return { ok: false, status: 403, error: "forbidden" };
  if (!isUuid(input.employeeId)) return { ok: false, status: 404, error: "employee not found" };
  const actor = input.actor;

  const parsed = parseTerminateInput(input.raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const store = input.store ?? pgTerminateStore();
  const now = input.now ?? new Date();
  const adminNote = `terminated: ${parsed.value.reason}`;

  try {
    const counts = await store.withEmployeeLock(input.employeeId, async () => {
      const employee = await store.getEmployee(input.orgId, input.employeeId);
      if (!employee) return { ok: false as const, status: 404 as const, error: "employee not found" };
      if (!employee.active) {
        return { ok: false as const, status: 409 as const, error: "employee is already inactive" };
      }
      if (parsed.value.endDate < employee.startDate) {
        return { ok: false as const, status: 400 as const, error: "endDate must be on or after startDate" };
      }

      await store.markInactive(employee.id, parsed.value.endDate);
      const entries = await store.listEntries(employee.id);
      let cancelledPending = 0;
      let reversedUsage = 0;

      for (const entry of entries) {
        const future = entryHasDayAfter(entry, parsed.value.endDate);
        if ((entry.status === "pending" || entry.status === "draft") && future) {
          await store.cancelEntry({
            id: entry.id,
            actorId: actor.id,
            now,
            adminNote,
          });
          cancelledPending += 1;
          continue;
        }
        if (entry.status === "approved" && future) {
          reversedUsage += await store.reverseUsageAfter({
            leaveEntryId: entry.id,
            endDate: parsed.value.endDate,
            createdBy: actor.id,
            reason: "employee.terminate",
            createdAt: now,
          });
          await store.deactivateDaysAfter(entry.id, parsed.value.endDate);
          const remaining = entry.days.filter((day) => day.onDate <= parsed.value.endDate);
          if (remaining.length === 0) {
            await store.cancelEntry({
              id: entry.id,
              actorId: actor.id,
              now,
              adminNote,
            });
          }
        }
      }

      const lockedEntries = await store.lockRemainingEntries(employee.id, now);
      return { ok: true as const, cancelledPending, reversedUsage, lockedEntries };
    });

    if (!counts.ok) return counts;

    const downloadPath = terminationCsvDownloadPath(input.employeeId, parsed.value.endDate);
    const built = await (input.buildExport ?? buildExport)({
      orgId: input.orgId,
      kind: "termination",
      employeeId: input.employeeId,
      endDate: parsed.value.endDate,
      now,
    });
    const csv = built.ok ? built.csv : "";
    const filename = built.ok ? built.filename : `termination-${parsed.value.endDate}.csv`;

    await tryWriteAudit(input.writeAudit ?? writeAuditEvent, {
      actorId: actor.id,
      action: "employee.terminate",
      entityType: "employee",
      entityId: input.employeeId,
      after: {
        endDate: parsed.value.endDate,
        reason: parsed.value.reason,
        active: false,
        cancelledPending: counts.cancelledPending,
        reversedUsage: counts.reversedUsage,
        lockedEntries: counts.lockedEntries,
        filename,
        downloadPath,
      },
    });

    return {
      ok: true,
      employee: { id: input.employeeId, endDate: parsed.value.endDate, active: false },
      cancelledPending: counts.cancelledPending,
      reversedUsage: counts.reversedUsage,
      lockedEntries: counts.lockedEntries,
      filename,
      downloadPath,
      csv,
    };
  } catch (err) {
    const mapped = writeInputError(err);
    if (mapped) return mapped;
    throw err;
  }
}
