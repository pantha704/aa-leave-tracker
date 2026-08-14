import { asAuditUuid, tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import {
  canAdmin,
  canCancelEntry,
  type AuthzActor,
  type PeriodGate,
} from "@/server/authz";
import type { LeaveStatus } from "@/server/policy/types";
import {
  assertYearlyLimits,
  dbLeaveStore,
  evaluateFrozenDays,
  isOccupancyConflict,
  postUsageForDays,
  type LeaveDayRecord,
  type LeaveEntryRecord,
  type LeaveFail,
  type LeaveStore,
  type SubmitLeaveSuccess,
} from "./submit";

export type DecideAction = "approve" | "reject" | "cancel";

export type DecideLeaveInput = {
  actor: AuthzActor | null;
  entryId: string;
  action: DecideAction;
  adminNote?: string | null;
  override?: boolean;
};

export type DecideLeaveOptions = {
  store?: LeaveStore;
  writeAudit?: AuditWriter;
  now?: Date;
  /** Test clock only. Production derives org-local today from `now`. */
  today?: string;
};

export type DecideLeaveSuccess = SubmitLeaveSuccess & { action: DecideAction };

const APPROVE_FROM = new Set<LeaveStatus>(["pending"]);
const REJECT_FROM = new Set<LeaveStatus>(["pending"]);
const CANCEL_FROM = new Set<LeaveStatus>(["draft", "pending", "approved"]);

function fail(status: 401 | 403 | 404 | 409 | 422, code: string, message: string): LeaveFail {
  return { ok: false, status, code, message };
}

export function nextStatus(from: LeaveStatus, action: DecideAction): LeaveStatus | null {
  if (action === "approve") return APPROVE_FROM.has(from) ? "approved" : null;
  if (action === "reject") return REJECT_FROM.has(from) ? "rejected" : null;
  if (action === "cancel") return CANCEL_FROM.has(from) ? "cancelled" : null;
  return null;
}

function yearsTouched(entry: LeaveEntryRecord, days: readonly LeaveDayRecord[]): number[] {
  const years = new Set<number>();
  if (days.length === 0) {
    years.add(Number(entry.startDate.slice(0, 4)));
    years.add(Number(entry.endDate.slice(0, 4)));
  }
  for (const day of days) {
    years.add(Number(day.onDate.slice(0, 4)));
  }
  return [...years];
}

function periodGateFor(
  entry: LeaveEntryRecord,
  days: readonly LeaveDayRecord[],
  statuses: readonly { year: number; status: string }[],
  today: string,
): PeriodGate {
  const byYear = new Map(statuses.map((row) => [row.year, row.status]));
  const open = yearsTouched(entry, days).every((year) => byYear.get(year) === "open");
  return { open, today };
}

function adminNoteFor(actor: AuthzActor, note: string | null | undefined): string | null | undefined {
  if (!canAdmin(actor)) return undefined;
  return note;
}

export async function decideLeave(
  input: DecideLeaveInput,
  options: DecideLeaveOptions = {},
): Promise<DecideLeaveSuccess | LeaveFail> {
  const actor = input.actor;
  if (!actor) return fail(401, "UNAUTHENTICATED", "unauthenticated");

  const store = options.store ?? dbLeaveStore;
  const now = options.now ?? new Date();
  if (!asAuditUuid(input.entryId)) return fail(404, "NOT_FOUND", "leave entry not found");
  const found = await store.getEntry(input.entryId);
  if (!found) return fail(404, "NOT_FOUND", "leave entry not found");

  try {
    return await store.withEmployeeLock(found.entry.employeeId, async () => {
      const current = await store.getEntry(input.entryId);
      if (!current) return fail(404, "NOT_FOUND", "leave entry not found");

      const { entry, days } = current;
      const target = nextStatus(entry.status, input.action);
      if (!target) {
        return fail(409, "INVALID_TRANSITION", `cannot ${input.action} a ${entry.status} entry`);
      }

      const loaded = await store.loadSubmitSnapshot({
        employeeId: entry.employeeId,
        leaveTypeId: entry.leaveTypeId,
        today: options.today,
      });
      if (!loaded.ok && loaded.reason === "no_policy") {
        return fail(422, "NO_POLICY", "No policy assignment for this employee and leave type.");
      }
      if (!loaded.ok) return fail(404, "NOT_FOUND", "employee or leave type not found");
      const snap = loaded.snapshot;
      const today = options.today ?? snap.today;
      const period = periodGateFor(entry, days, snap.periodStatuses, today);
      const adminNote = adminNoteFor(actor, input.adminNote);

      if (input.action === "approve" || input.action === "reject") {
        if (!canAdmin(actor)) return fail(403, "FORBIDDEN", "forbidden");
      } else if (
        !canCancelEntry(
          actor,
          {
            employeeId: entry.employeeId,
            status: entry.status,
            immutableAt: entry.immutableAt,
            startDate: entry.startDate,
            managerId: entry.managerId ?? snap.employee.managerId,
          },
          period,
        )
      ) {
        return fail(403, "FORBIDDEN", "forbidden");
      }

      if (snap.orgSettings.appReadonly && input.action !== "cancel") {
        return fail(403, "APP_READONLY", "The application is in read-only mode.");
      }

      if (input.action === "approve") {
        const frozen = evaluateFrozenDays({
          entry,
          days,
          snap,
          override: canAdmin(actor) && input.override === true,
        });
        if (frozen) return frozen;

        const yearly = await assertYearlyLimits({
          store,
          employeeId: entry.employeeId,
          leaveTypeId: entry.leaveTypeId,
          days: days.filter((day) => day.slotActive),
          policy: {
            ...snap.policy,
            consumesBalance: snap.leaveType.consumesBalance,
            unlimited: snap.leaveType.unlimited,
            weekendDays: snap.employee.weekendDays,
            workdayMinutes: snap.employee.orgWorkdayMinutes,
          },
          consumesBalance: snap.leaveType.consumesBalance,
          unlimited: snap.leaveType.unlimited,
          excludePendingDays: entry.status === "pending" ? days : undefined,
        });
        if (yearly) return yearly;

        await store.updateEntry(entry.id, {
          status: "approved",
          updatedBy: actor.id,
          updatedAt: now,
          adminNote,
        });
        await postUsageForDays(store, {
          employeeId: entry.employeeId,
          leaveTypeId: entry.leaveTypeId,
          days,
          createdBy: actor.id,
          createdAt: now,
        });

        const approved = {
          ...entry,
          status: "approved" as const,
          updatedBy: actor.id,
          updatedAt: now,
          adminNote: adminNote !== undefined ? adminNote : entry.adminNote,
        };
        await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
          actorId: actor.id,
          action: "leave.approve",
          entityType: "leave_entry",
          entityId: entry.id,
          before: { status: entry.status },
          after: { status: "approved" },
        });
        return {
          ok: true,
          status: 200,
          action: "approve",
          entry: approved,
          days,
          intent: entry.intent,
          ledgerPosted: days.some((day) => day.slotActive && day.consumesBalance),
        };
      }

      await store.updateEntry(entry.id, {
        status: target,
        updatedBy: actor.id,
        updatedAt: now,
        adminNote,
      });
      await store.deactivateDays(entry.id);
      if (entry.status === "approved") {
        await store.reverseUsageForEntry({
          leaveEntryId: entry.id,
          createdBy: actor.id,
          reason: `leave.${input.action}`,
          createdAt: now,
        });
      }

      await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
        actorId: actor.id,
        action: `leave.${input.action}`,
        entityType: "leave_entry",
        entityId: entry.id,
        before: { status: entry.status },
        after: { status: target, slotActive: false },
      });

      return {
        ok: true,
        status: 200,
        action: input.action,
        entry: {
          ...entry,
          status: target,
          updatedBy: actor.id,
          updatedAt: now,
          adminNote: adminNote !== undefined ? adminNote : entry.adminNote,
        },
        days: days.map((day) => ({ ...day, slotActive: false })),
        intent: entry.intent,
        ledgerPosted: false,
      };
    });
  } catch (err) {
    if (isOccupancyConflict(err)) {
      return fail(409, "OVERLAP", "A consuming leave day already occupies that date and portion.");
    }
    throw err;
  }
}
