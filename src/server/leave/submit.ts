import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  employees,
  holidays,
  leaveDays,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { canAdmin, canReadEmployee, type AuthzActor } from "@/server/authz";
import {
  asOfDateString,
  calendarYearBounds,
  getBalance,
  pendingMinutesInPeriod,
  requireIsoDate,
  type LedgerDb,
  type LedgerKind,
} from "@/server/ledger/balance";
import { isUniqueViolation } from "@/server/pg-error";
import { closedPeriod } from "@/server/policy/rules/closed-period";
import { minIncrement } from "@/server/policy/rules/min-increment";
import { negativeBalance } from "@/server/policy/rules/negative-balance";
import { overlap } from "@/server/policy/rules/overlap";
import { takeCeiling } from "@/server/policy/rules/take-ceiling";
import { waitingPeriod } from "@/server/policy/rules/waiting-period";
import {
  postLedgerEntryInTx,
  prepareReversal,
  withEmployeeLock,
  type PostLedgerInput,
} from "@/server/ledger/post";
import { evaluateLeave } from "@/server/policy/engine";
import { spanCrossesToday } from "@/server/policy/rules/span-crosses-today";
import type {
  ExistingLeave,
  HolidayDate,
  Intent,
  LeaveStatus,
  PeriodStatus,
  PolicyBalance,
  PolicySnapshot,
  Portion,
} from "@/server/policy/types";
import { getDb } from "@/server/db";
import { expandToLeaveDays } from "./expand";

const DECIMAL_HOURS = /^-?\d+(\.\d+)?$/;
const PORTIONS = new Set<Portion>(["full", "am", "pm", "custom"]);

export type LeaveFailStatus = 401 | 403 | 404 | 409 | 422;

export type LeaveFail = {
  ok: false;
  status: LeaveFailStatus;
  code: string;
  message: string;
};

export type LeaveEntryRecord = {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  intent: Intent;
  status: LeaveStatus;
  immutableAt: Date | null;
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes: number | null;
  totalMinutes: number;
  note: string | null;
  adminNote: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  managerId?: string | null;
};

export type LeaveDayRecord = {
  id: string;
  leaveEntryId: string;
  employeeId: string;
  onDate: string;
  minutes: number;
  portion: Portion;
  consumesBalance: boolean;
  slotActive: boolean;
};

export type SubmitSnapshot = {
  employee: {
    id: string;
    startDate: string;
    workdayMinutes: number | null;
    role: string;
    managerId: string | null;
    orgWorkdayMinutes: number;
    weekendDays: number[];
    timezone: string;
  };
  leaveType: {
    id: string;
    consumesBalance: boolean;
    unlimited: boolean;
    minIncrementMinutes: number | null;
  };
  policy: PolicySnapshot;
  holidays: HolidayDate[];
  existing: ExistingLeave[];
  periodStatuses: PeriodStatus[];
  today: string;
  balance: PolicyBalance;
  orgSettings: OrgLeaveSettings;
};

export type OrgLeaveSettings = {
  appReadonly: boolean;
  selfLogEnabled: boolean;
  requestsEnabled: boolean;
};

export type LoadSnapshotResult =
  | { ok: true; snapshot: SubmitSnapshot }
  | { ok: false; reason: "not_found" | "no_policy" };

export type LeaveStore = {
  withEmployeeLock: <T>(employeeId: string, fn: () => Promise<T>) => Promise<T>;
  loadSubmitSnapshot: (input: {
    employeeId: string;
    leaveTypeId: string;
    today?: string;
  }) => Promise<LoadSnapshotResult>;
  getBalanceAsOf: (input: {
    employeeId: string;
    leaveTypeId: string;
    asOf: string;
    timeZone?: string;
  }) => Promise<PolicyBalance>;
  insertEntry: (entry: LeaveEntryRecord, days: LeaveDayRecord[]) => Promise<void>;
  getEntry: (id: string) => Promise<{ entry: LeaveEntryRecord; days: LeaveDayRecord[] } | null>;
  updateEntry: (
    id: string,
    patch: {
      status: LeaveStatus;
      updatedBy: string;
      updatedAt: Date;
      adminNote?: string | null;
    },
  ) => Promise<void>;
  deactivateDays: (leaveEntryId: string) => Promise<void>;
  postUsage: (input: {
    employeeId: string;
    leaveTypeId: string;
    day: LeaveDayRecord;
    createdBy: string;
    createdAt: Date;
  }) => Promise<void>;
  reverseUsageForEntry: (input: {
    leaveEntryId: string;
    createdBy: string;
    reason: string;
    createdAt: Date;
  }) => Promise<void>;
};

export type SubmitLeaveInput = {
  actor: AuthzActor | null;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes?: number | null;
  customHours?: string | number | null;
  note?: string | null;
  override?: boolean;
};

export type SubmitLeaveSuccess = {
  ok: true;
  status: 200;
  entry: LeaveEntryRecord;
  days: LeaveDayRecord[];
  intent: Intent;
  ledgerPosted: boolean;
};

export type SubmitLeaveOptions = {
  store?: LeaveStore;
  writeAudit?: AuditWriter;
  now?: Date;
  /** Test clock only. Production derives org-local today from `now`. */
  today?: string;
};

function fail(status: LeaveFailStatus, code: string, message: string): LeaveFail {
  return { ok: false, status, code, message };
}

export function toApiCode(code: string): string {
  return code.toUpperCase();
}

/** Hours stay at the API boundary; ledger and days are integer minutes. */
export function hoursToMinutes(hours: string): number {
  return Math.round(Number(hours) * 60);
}

export function parseCustomHours(hours: unknown):
  | { ok: true; minutes: number }
  | { ok: false; code: "INVALID_CUSTOM_HOURS"; message: string } {
  if (typeof hours !== "string") {
    return {
      ok: false,
      code: "INVALID_CUSTOM_HOURS",
      message: "customHours must be a decimal string",
    };
  }
  const trimmed = hours.trim();
  if (!DECIMAL_HOURS.test(trimmed) || !Number.isFinite(Number(trimmed))) {
    return {
      ok: false,
      code: "INVALID_CUSTOM_HOURS",
      message: "customHours must be a decimal string",
    };
  }
  return { ok: true, minutes: hoursToMinutes(trimmed) };
}

export function resolveCustomMinutes(input: {
  portion: Portion;
  customMinutes?: number | null;
  customHours?: string | number | null;
}): { ok: true; customMinutes: number | null } | LeaveFail {
  if (input.portion !== "custom") {
    return { ok: true, customMinutes: null };
  }
  const hasMinutes = input.customMinutes != null;
  const hasHours = input.customHours != null && input.customHours !== "";
  if (hasMinutes && hasHours) {
    const parsed = parseCustomHours(input.customHours);
    if (!parsed.ok) return fail(422, parsed.code, parsed.message);
    if (parsed.minutes !== input.customMinutes) {
      return fail(422, "INVALID_CUSTOM_HOURS", "customMinutes and customHours do not match");
    }
    return { ok: true, customMinutes: input.customMinutes ?? null };
  }
  if (hasMinutes) {
    if (!Number.isInteger(input.customMinutes)) {
      return fail(422, "INVALID_CUSTOM_MINUTES", "customMinutes must be an integer");
    }
    return { ok: true, customMinutes: input.customMinutes ?? null };
  }
  if (hasHours) {
    const parsed = parseCustomHours(input.customHours);
    if (!parsed.ok) return fail(422, parsed.code, parsed.message);
    return { ok: true, customMinutes: parsed.minutes };
  }
  return { ok: true, customMinutes: null };
}

/** log iff end <= today; request otherwise. Span start < today < end is 422. */
export function intentFromDates(
  startDate: string,
  endDate: string,
  today: string,
): { ok: true; intent: Intent } | LeaveFail {
  const start = requireIsoDate(startDate, "startDate");
  const end = requireIsoDate(endDate, "endDate");
  const day = requireIsoDate(today, "today");
  if (end < start) {
    return fail(422, "INVALID_DATES", "endDate must be on or after startDate");
  }
  const span = spanCrossesToday({ startDate: start, endDate: end, today: day });
  if (span) {
    return fail(422, toApiCode(span.code), span.message);
  }
  return { ok: true, intent: end <= day ? "log" : "request" };
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return asOfDateString(now, timeZone);
}

export function isOccupancyConflict(err: unknown): boolean {
  if (isUniqueViolation(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /overlap|unique|already exists/i.test(message);
}

export function yearsFromDays(days: readonly { onDate: string }[]): number[] {
  return [...new Set(days.map((day) => Number(day.onDate.slice(0, 4))))].sort();
}

function yearEnd(year: number): string {
  return calendarYearBounds(year).yearEnd;
}

function requestedInYear(
  days: readonly { onDate: string; minutes: number }[],
  year: number,
): number {
  return pendingMinutesInPeriod(
    {
      status: "pending",
      totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
      startDate: days[0]?.onDate ?? `${year}-01-01`,
      endDate: days[days.length - 1]?.onDate ?? `${year}-12-31`,
      days: days.map((day) => ({ onDate: day.onDate, minutes: day.minutes })),
    },
    year,
  );
}

export async function assertYearlyLimits(input: {
  store: LeaveStore;
  employeeId: string;
  leaveTypeId: string;
  days: readonly { onDate: string; minutes: number }[];
  policy: PolicySnapshot;
  consumesBalance: boolean;
  unlimited: boolean;
  excludePendingDays?: readonly { onDate: string; minutes: number }[];
}): Promise<LeaveFail | null> {
  const years = yearsFromDays(input.days);
  for (const year of years) {
    const balance = await input.store.getBalanceAsOf({
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      asOf: yearEnd(year),
    });
    const exclude = input.excludePendingDays
      ? requestedInYear(input.excludePendingDays, year)
      : 0;
    const adjusted = {
      ...balance,
      requestedMinutes: Math.max(0, balance.requestedMinutes - exclude),
      availableMinutes: balance.availableMinutes + exclude,
    };
    const thisMinutes = requestedInYear(input.days, year);
    const ceiling = takeCeiling({
      balance: adjusted,
      thisMinutes,
      takeCeilingMinutes: input.policy.takeCeilingMinutes,
      consumesBalance: input.consumesBalance,
      unlimited: input.unlimited,
    });
    if (ceiling) return fail(422, toApiCode(ceiling.code), ceiling.message);
    const negative = negativeBalance({
      balance: adjusted,
      thisMinutes,
      negativeAllowed: input.policy.negativeAllowed ?? false,
      negativeFloorMinutes: input.policy.negativeFloorMinutes,
      consumesBalance: input.consumesBalance,
      unlimited: input.unlimited,
    });
    if (negative) return fail(422, toApiCode(negative.code), negative.message);
  }
  return null;
}

/** Overlap / closed / increment / wait against the persisted day rows — no re-expand. */
export function evaluateFrozenDays(input: {
  entry: LeaveEntryRecord;
  days: readonly LeaveDayRecord[];
  snap: SubmitSnapshot;
  override?: boolean;
}): LeaveFail | null {
  const workdayMinutes =
    input.snap.employee.workdayMinutes ?? input.snap.employee.orgWorkdayMinutes;
  const wait = waitingPeriod({
    startDate: input.entry.startDate,
    hireDate: input.snap.employee.startDate,
    waitingPeriodDays: input.snap.policy.waitingPeriodDays ?? 0,
    consumesBalance: input.snap.leaveType.consumesBalance,
    override: input.override === true,
  });
  if (wait) return fail(422, toApiCode(wait.code), wait.message);
  const active = input.days.filter((day) => day.slotActive);
  if (active.length === 0) {
    return fail(422, "HOLIDAYS_EXCLUDED", "No working days in the requested range.");
  }
  const closed = closedPeriod({ days: active, periodStatuses: input.snap.periodStatuses });
  if (closed) return fail(422, toApiCode(closed.code), closed.message);
  const clash = overlap({
    days: active,
    consumesBalance: input.snap.leaveType.consumesBalance,
    existing: input.snap.existing,
    entryId: input.entry.id,
    holidays: input.snap.holidays,
    weekendDays: input.snap.employee.weekendDays,
    workdayMinutes,
  });
  if (clash) return fail(422, toApiCode(clash.code), clash.message);
  const increment = minIncrement({
    days: active,
    incrementMinutes: input.snap.policy.minIncrementMinutes,
  });
  if (increment) return fail(422, toApiCode(increment.code), increment.message);
  return null;
}

export function gateOrgWrites(
  settings: OrgLeaveSettings,
  intent: Intent,
): LeaveFail | null {
  if (settings.appReadonly) {
    return fail(403, "APP_READONLY", "The application is in read-only mode.");
  }
  if (intent === "log" && !settings.selfLogEnabled) {
    return fail(422, "SELF_LOG_DISABLED", "Self-logging is disabled.");
  }
  if (intent === "request" && !settings.requestsEnabled) {
    return fail(422, "REQUESTS_DISABLED", "Leave requests are disabled.");
  }
  return null;
}

function canSubmitFor(actor: AuthzActor, employeeId: string, managerId?: string | null): boolean {
  if (!canReadEmployee(actor, employeeId, { managerId })) return false;
  return canAdmin(actor) || actor.id === employeeId;
}

function policyFromSnapshot(snap: SubmitSnapshot): PolicySnapshot {
  return {
    ...snap.policy,
    consumesBalance: snap.leaveType.consumesBalance,
    unlimited: snap.leaveType.unlimited,
    weekendDays: snap.employee.weekendDays,
    workdayMinutes: snap.employee.orgWorkdayMinutes,
  };
}

export async function postUsageForDays(
  store: LeaveStore,
  input: {
    employeeId: string;
    leaveTypeId: string;
    days: readonly LeaveDayRecord[];
    createdBy: string;
    createdAt: Date;
  },
): Promise<void> {
  for (const day of input.days) {
    if (!day.slotActive || !day.consumesBalance) continue;
    await store.postUsage({
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      day,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
  }
}

export async function submitLeave(
  input: SubmitLeaveInput,
  options: SubmitLeaveOptions = {},
): Promise<SubmitLeaveSuccess | LeaveFail> {
  const actor = input.actor;
  if (!actor) return fail(401, "UNAUTHENTICATED", "unauthenticated");
  if (!PORTIONS.has(input.portion)) {
    return fail(422, "INVALID_PORTION", "portion must be full, am, pm, or custom");
  }

  const store = options.store ?? dbLeaveStore;
  const now = options.now ?? new Date();

  try {
    return await store.withEmployeeLock(input.employeeId, async () => {
      const loaded = await store.loadSubmitSnapshot({
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        today: options.today,
      });
      if (!loaded.ok && loaded.reason === "no_policy") {
        return fail(422, "NO_POLICY", "No policy assignment for this employee and leave type.");
      }
      if (!loaded.ok) return fail(404, "NOT_FOUND", "employee or leave type not found");
      const snap = loaded.snapshot;
      if (!canSubmitFor(actor, input.employeeId, snap.employee.managerId)) {
        return fail(403, "FORBIDDEN", "forbidden");
      }

      const today = options.today ?? snap.today;
      let intent: Intent;
      try {
        const resolved = intentFromDates(input.startDate, input.endDate, today);
        if (!resolved.ok) return resolved;
        intent = resolved.intent;
      } catch (err) {
        const message = err instanceof Error ? err.message : "invalid date";
        return fail(422, "INVALID_DATES", message);
      }

      const custom = resolveCustomMinutes({
        portion: input.portion,
        customMinutes: input.customMinutes,
        customHours: input.customHours,
      });
      if (!custom.ok) return custom;

      const gated = gateOrgWrites(snap.orgSettings, intent);
      if (gated) return gated;

      const policy = policyFromSnapshot(snap);
      let evaluation: ReturnType<typeof evaluateLeave>;
      try {
        evaluation = evaluateLeave({
          employee: {
            startDate: snap.employee.startDate,
            workdayMinutes: snap.employee.workdayMinutes,
            role: snap.employee.role,
          },
          entry: {
            startDate: input.startDate,
            endDate: input.endDate,
            portion: input.portion,
            customMinutes: custom.customMinutes,
            intent,
            consumesBalance: snap.leaveType.consumesBalance,
            unlimited: snap.leaveType.unlimited,
          },
          policy: {
            ...policy,
            takeCeilingMinutes: null,
            negativeAllowed: true,
            negativeFloorMinutes: null,
          },
          balance: snap.balance,
          holidays: snap.holidays,
          existing: snap.existing,
          today,
          periodStatuses: snap.periodStatuses,
          override: canAdmin(actor) && input.override === true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "evaluate failed";
        return fail(422, "INVALID_POLICY", message);
      }
      if (!evaluation.ok) {
        return fail(422, toApiCode(evaluation.code), evaluation.message);
      }

      const drafts = expandToLeaveDays({
        startDate: input.startDate,
        endDate: input.endDate,
        portion: input.portion,
        customMinutes: custom.customMinutes,
        consumesBalance: snap.leaveType.consumesBalance,
        holidays: snap.holidays,
        weekendDays: snap.employee.weekendDays,
        workdayMinutes:
          snap.employee.workdayMinutes ?? snap.employee.orgWorkdayMinutes,
      });

      const entryId = crypto.randomUUID();
      const entry: LeaveEntryRecord = {
        id: entryId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        intent,
        status: evaluation.newStatus,
        immutableAt: null,
        startDate: requireIsoDate(input.startDate, "startDate"),
        endDate: requireIsoDate(input.endDate, "endDate"),
        portion: input.portion,
        customMinutes: custom.customMinutes,
        totalMinutes: evaluation.minutes,
        note: input.note ?? null,
        adminNote: null,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
        managerId: snap.employee.managerId,
      };
      const days: LeaveDayRecord[] = drafts.map((day) => ({
        id: crypto.randomUUID(),
        leaveEntryId: entryId,
        employeeId: input.employeeId,
        onDate: day.onDate,
        minutes: day.minutes,
        portion: day.portion,
        consumesBalance: day.consumesBalance,
        slotActive: day.slotActive,
      }));

      const yearly = await assertYearlyLimits({
        store,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        days,
        policy,
        consumesBalance: snap.leaveType.consumesBalance,
        unlimited: snap.leaveType.unlimited,
      });
      if (yearly) return yearly;

      await store.insertEntry(entry, days);

      if (evaluation.postsLedger) {
        await postUsageForDays(store, {
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          days,
          createdBy: actor.id,
          createdAt: now,
        });
      }

      await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
        actorId: actor.id,
        action: "leave.submit",
        entityType: "leave_entry",
        entityId: entry.id,
        after: { intent, status: entry.status, ledgerPosted: evaluation.postsLedger },
      });

      return {
        ok: true as const,
        status: 200 as const,
        entry,
        days,
        intent,
        ledgerPosted: evaluation.postsLedger,
      };
    });
  } catch (err) {
    if (isOccupancyConflict(err)) {
      return fail(409, "OVERLAP", "A consuming leave day already occupies that date and portion.");
    }
    throw err;
  }
}

const dbAls = new AsyncLocalStorage<LedgerDb>();
const rootAls = new AsyncLocalStorage<LedgerDb>();

function currentDb(): LedgerDb {
  return dbAls.getStore() ?? rootAls.getStore() ?? getDb();
}

function currentRoot(): LedgerDb {
  return rootAls.getStore() ?? getDb();
}

export function runWithLeaveDb<T>(db: LedgerDb, fn: () => Promise<T>): Promise<T> {
  return rootAls.run(db, fn);
}

function asIntent(value: string): Intent {
  if (value === "log" || value === "request") return value;
  throw new Error(`invalid intent: ${value}`);
}

function asStatus(value: string): LeaveStatus {
  if (
    value === "draft" ||
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`invalid status: ${value}`);
}

function asPortion(value: string): Portion {
  if (value === "full" || value === "am" || value === "pm" || value === "custom") return value;
  throw new Error(`invalid portion: ${value}`);
}

function toEntryRecord(
  row: typeof leaveEntries.$inferSelect,
  managerId?: string | null,
): LeaveEntryRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    intent: asIntent(row.intent),
    status: asStatus(row.status),
    immutableAt: row.immutableAt,
    startDate: row.startDate,
    endDate: row.endDate,
    portion: asPortion(row.portion),
    customMinutes: row.customMinutes,
    totalMinutes: row.totalMinutes,
    note: row.note,
    adminNote: row.adminNote,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    managerId,
  };
}

function toDayRecord(row: typeof leaveDays.$inferSelect): LeaveDayRecord {
  return {
    id: row.id,
    leaveEntryId: row.leaveEntryId,
    employeeId: row.employeeId,
    onDate: row.onDate,
    minutes: row.minutes,
    portion: asPortion(row.portion),
    consumesBalance: row.consumesBalance,
    slotActive: row.slotActive,
  };
}

export const dbLeaveStore: LeaveStore = {
  async withEmployeeLock(employeeId, fn) {
    return withEmployeeLock(currentRoot(), employeeId, async (tx) => dbAls.run(tx, fn));
  },

  async loadSubmitSnapshot(input) {
    const db = currentDb();
    const empRows = await db
      .select({
        id: employees.id,
        orgId: employees.orgId,
        startDate: employees.startDate,
        workdayMinutes: employees.workdayMinutes,
        role: employees.role,
        managerId: employees.managerId,
        timezone: organizations.timezone,
        orgWorkdayMinutes: organizations.standardWorkdayMinutes,
        weekendDays: organizations.weekendDays,
      })
      .from(employees)
      .innerJoin(organizations, eq(employees.orgId, organizations.id))
      .where(eq(employees.id, input.employeeId))
      .limit(1);
    const emp = empRows[0];
    if (!emp) return { ok: false, reason: "not_found" };

    const typeRows = await db
      .select({
        id: leaveTypes.id,
        consumesBalance: leaveTypes.consumesBalance,
        unlimited: leaveTypes.unlimited,
        minIncrementMinutes: leaveTypes.minIncrementMinutes,
      })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.orgId, emp.orgId)))
      .limit(1);
    const leaveType = typeRows[0];
    if (!leaveType) return { ok: false, reason: "not_found" };

    const assigned = await db
      .select({
        takeCeilingMinutes: policies.takeCeilingMinutes,
        minIncrementMinutes: policies.minIncrementMinutes,
        negativeAllowed: policies.negativeAllowed,
        negativeFloorMinutes: policies.negativeFloorMinutes,
        waitingPeriodDays: policies.waitingPeriodDays,
        approvalForRequest: policies.approvalForRequest,
        approvalForLog: policies.approvalForLog,
      })
      .from(policyAssignments)
      .innerJoin(policies, eq(policyAssignments.policyId, policies.id))
      .where(
        and(
          eq(policyAssignments.employeeId, input.employeeId),
          eq(policyAssignments.leaveTypeId, input.leaveTypeId),
        ),
      )
      .limit(1);
    const policyRow = assigned[0];
    if (!policyRow) return { ok: false, reason: "no_policy" };

    const holidayRows = await db
      .select({ onDate: holidays.onDate })
      .from(holidays)
      .where(eq(holidays.orgId, emp.orgId));

    const entryRows = await db
      .select()
      .from(leaveEntries)
      .where(eq(leaveEntries.employeeId, input.employeeId));
    const entryIds = entryRows.map((row) => row.id);
    const dayRows =
      entryIds.length === 0
        ? []
        : await db.select().from(leaveDays).where(inArray(leaveDays.leaveEntryId, entryIds));
    const daysByEntry = new Map<string, LeaveDayRecord[]>();
    for (const day of dayRows) {
      const list = daysByEntry.get(day.leaveEntryId) ?? [];
      list.push(toDayRecord(day));
      daysByEntry.set(day.leaveEntryId, list);
    }

    const existing: ExistingLeave[] = entryRows.map((row) => {
      const days = daysByEntry.get(row.id) ?? [];
      return {
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate,
        portion: asPortion(row.portion),
        customMinutes: row.customMinutes,
        consumesBalance: days[0]?.consumesBalance ?? leaveType.consumesBalance,
        status: row.status,
        slotActive: days.some((day) => day.slotActive),
        days: days.map((day) => ({
          onDate: day.onDate,
          portion: day.portion,
          consumesBalance: day.consumesBalance,
          slotActive: day.slotActive,
        })),
      };
    });

    const periodRows = await db
      .select({ year: policyPeriods.year, status: policyPeriods.status })
      .from(policyPeriods)
      .where(eq(policyPeriods.orgId, emp.orgId));

    const settingsRows = await db
      .select({
        appReadonly: orgSettings.appReadonly,
        selfLogEnabled: orgSettings.selfLogEnabled,
        requestsEnabled: orgSettings.requestsEnabled,
      })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, emp.orgId))
      .limit(1);
    const settings = settingsRows[0];

    const today = input.today ?? todayInTimeZone(emp.timezone);
    const balance = await getBalance(db, {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      asOf: today,
      timeZone: emp.timezone,
    });

    const approvalForRequest =
      policyRow.approvalForRequest === "none" ||
      policyRow.approvalForRequest === "manager" ||
      policyRow.approvalForRequest === "admin"
        ? policyRow.approvalForRequest
        : "admin";
    const approvalForLog =
      policyRow.approvalForLog === "none" ||
      policyRow.approvalForLog === "manager" ||
      policyRow.approvalForLog === "admin"
        ? policyRow.approvalForLog
        : "none";

    return {
      ok: true,
      snapshot: {
        employee: {
          id: emp.id,
          startDate: emp.startDate,
          workdayMinutes: emp.workdayMinutes,
          role: emp.role,
          managerId: emp.managerId,
          orgWorkdayMinutes: emp.orgWorkdayMinutes,
          weekendDays: emp.weekendDays,
          timezone: emp.timezone,
        },
        leaveType,
        policy: {
          takeCeilingMinutes: policyRow.takeCeilingMinutes,
          minIncrementMinutes: policyRow.minIncrementMinutes,
          negativeAllowed: policyRow.negativeAllowed,
          negativeFloorMinutes: policyRow.negativeFloorMinutes,
          waitingPeriodDays: policyRow.waitingPeriodDays,
          approvalForRequest,
          approvalForLog,
          consumesBalance: leaveType.consumesBalance,
          unlimited: leaveType.unlimited,
          weekendDays: emp.weekendDays,
          workdayMinutes: emp.orgWorkdayMinutes,
        },
        holidays: holidayRows,
        existing,
        periodStatuses: periodRows,
        today,
        balance,
        orgSettings: {
          appReadonly: settings?.appReadonly ?? false,
          selfLogEnabled: settings?.selfLogEnabled ?? true,
          requestsEnabled: settings?.requestsEnabled ?? true,
        },
      },
    };
  },

  async getBalanceAsOf(input) {
    return getBalance(currentDb(), {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      asOf: input.asOf,
      timeZone: input.timeZone,
    });
  },

  async insertEntry(entry, days) {
    const db = currentDb();
    await db.insert(leaveEntries).values({
      id: entry.id,
      employeeId: entry.employeeId,
      leaveTypeId: entry.leaveTypeId,
      intent: entry.intent,
      status: entry.status,
      immutableAt: entry.immutableAt,
      startDate: entry.startDate,
      endDate: entry.endDate,
      portion: entry.portion,
      customMinutes: entry.customMinutes,
      totalMinutes: entry.totalMinutes,
      note: entry.note,
      adminNote: entry.adminNote,
      createdBy: entry.createdBy,
      updatedBy: entry.updatedBy,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
    if (days.length > 0) {
      await db.insert(leaveDays).values(
        days.map((day) => ({
          id: day.id,
          leaveEntryId: day.leaveEntryId,
          employeeId: day.employeeId,
          onDate: day.onDate,
          minutes: day.minutes,
          portion: day.portion,
          consumesBalance: day.consumesBalance,
          slotActive: day.slotActive,
        })),
      );
    }
  },

  async getEntry(id) {
    const db = currentDb();
    const rows = await db.select().from(leaveEntries).where(eq(leaveEntries.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const empRows = await db
      .select({ managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.id, row.employeeId))
      .limit(1);
    const dayRows = await db.select().from(leaveDays).where(eq(leaveDays.leaveEntryId, id));
    return {
      entry: toEntryRecord(row, empRows[0]?.managerId),
      days: dayRows.map(toDayRecord),
    };
  },

  async updateEntry(id, patch) {
    const db = currentDb();
    await db
      .update(leaveEntries)
      .set({
        status: patch.status,
        updatedBy: patch.updatedBy,
        updatedAt: patch.updatedAt,
        ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}),
      })
      .where(eq(leaveEntries.id, id));
  },

  async deactivateDays(leaveEntryId) {
    const db = currentDb();
    await db.update(leaveDays).set({ slotActive: false }).where(eq(leaveDays.leaveEntryId, leaveEntryId));
  },

  async postUsage(input) {
    const payload: PostLedgerInput = {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      kind: "usage",
      minutes: input.day.minutes,
      effectiveOn: input.day.onDate,
      leaveEntryId: input.day.leaveEntryId,
      leaveDayId: input.day.id,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    };
    await postLedgerEntryInTx(currentDb(), payload);
  },

  async reverseUsageForEntry(input) {
    await reverseUsageRows(currentDb(), input);
  },
};

export async function reverseUsageRows(
  db: LedgerDb,
  input: { leaveEntryId: string; createdBy: string; reason: string; createdAt: Date },
): Promise<void> {
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.leaveEntryId, input.leaveEntryId),
        eq(ledgerEntries.kind, "usage"),
        isNull(ledgerEntries.reversedAt),
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
    await db
      .update(ledgerEntries)
      .set({ reversedAt: prepared.reversedAt })
      .where(and(eq(ledgerEntries.id, original.id), isNull(ledgerEntries.reversedAt)));
    await db.insert(ledgerEntries).values(prepared.reversal);
  }
}
