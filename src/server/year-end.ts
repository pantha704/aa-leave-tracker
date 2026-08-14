import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  employees,
  holidays,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  policies,
  policyAssignments,
  policyPeriods,
  yearEndSnapshots,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getDb } from "@/server/db";
import {
  calendarYearBounds,
  inclusiveIsoDates,
  isLiveLedgerRow,
  type LedgerDb,
  type LedgerSumRow,
} from "@/server/ledger/balance";
import { MemoryLedger } from "@/server/ledger/memory";
import {
  acquireEmployeeLock,
  postLedgerEntryInTx,
  reverseLedgerEntryInTx,
  type LedgerSession,
  type PostLedgerInput,
} from "@/server/ledger/post";
import { DEFAULT_WEEKEND_DAYS, isoWeekday } from "@/server/policy/days";

export const PERIOD_STATUSES = ["future", "open", "closing", "closed"] as const;
export type PolicyPeriodStatus = (typeof PERIOD_STATUSES)[number];

export function isPeriodStatus(value: string): value is PolicyPeriodStatus {
  return (PERIOD_STATUSES as readonly string[]).includes(value);
}

export function isPeriodOpen(status: string | null | undefined): boolean {
  return status === "open";
}

export function closeReason(year: number): string {
  return `close:${year}`;
}

export function reopenReason(year: number): string {
  return `reopen:${year}`;
}

export function openReason(year: number): string {
  return `open:${year}`;
}

export function isCloseTagged(reason: string | null | undefined, year: number): boolean {
  return reason === closeReason(year);
}

export type YearEndEmployee = {
  id: string;
  name: string;
  active: boolean;
  startDate: string;
  endDate: string | null;
};

export type YearEndLeaveType = {
  id: string;
  code: string;
  consumesBalance: boolean;
};

export type YearEndPolicy = {
  id: string;
  leaveTypeId: string;
  grantMode: string;
  grantMinutes: number | null;
  periodicCadence: string | null;
  periodicMinutes: number | null;
  carryoverMaxMinutes: number | null;
  allowForfeit: boolean;
  accrualStopMinutes: number | null;
};

export type YearEndAssignment = {
  employeeId: string;
  policyId: string;
  leaveTypeId: string;
  validFrom: string;
  validTo: string | null;
};

export type YearEndLedgerRow = LedgerSumRow & {
  id?: string;
  reason?: string | null;
};

export type YearEndWorld = {
  orgId: string;
  weekendDays: readonly number[];
  holidays: ReadonlySet<string>;
  periods: Map<number, PolicyPeriodStatus>;
  employees: YearEndEmployee[];
  leaveTypes: YearEndLeaveType[];
  policies: YearEndPolicy[];
  assignments: YearEndAssignment[];
  ledger: YearEndLedgerRow[];
};

export type ClosePreviewRow = {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  unusedMinutes: number;
  carryMinutes: number;
  forfeitMinutes: number;
  sickGrantMinutes: number;
  writesVacationLump: false;
};

export type PlannedLedgerPost = {
  employeeId: string;
  leaveTypeId: string;
  kind: "carryover" | "forfeit" | "grant_lump";
  minutes: number;
  effectiveOn: string;
  reason: string;
};

export type ClosePlan = {
  year: number;
  nextYear: number;
  preview: ClosePreviewRow[];
  posts: PlannedLedgerPost[];
};

export type YearEndResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 409 };

export type CloseYearOptions = {
  acknowledgeForfeit?: boolean;
};

export type CloseYearHooks = {
  /** Test hook: runs after `closing` is committed, before unused is recomputed under locks. */
  afterMarkClosing?: () => Promise<void> | void;
};

export type ReopenYearHooks = {
  /** Test hook: runs after the first reopen plan, before the in-tx re-check. */
  afterPlan?: () => Promise<void> | void;
};

export function parseCalendarYear(raw: string | number): number | null {
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 2000 || value > 2100) return null;
  return value;
}

export function assignmentCovers(
  assignment: Pick<YearEndAssignment, "validFrom" | "validTo">,
  onDate: string,
): boolean {
  if (assignment.validFrom > onDate) return false;
  if (assignment.validTo != null && assignment.validTo < onDate) return false;
  return true;
}

export function employeeActiveOn(employee: YearEndEmployee, onDate: string): boolean {
  if (!employee.active) return false;
  if (employee.startDate > onDate) return false;
  if (employee.endDate != null && employee.endDate < onDate) return false;
  return true;
}

export function countWorkingDays(
  startDate: string,
  endDate: string,
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
  holidaySet: ReadonlySet<string> = new Set(),
): number {
  const weekends = new Set(weekendDays);
  let count = 0;
  for (const onDate of inclusiveIsoDates(startDate, endDate)) {
    if (weekends.has(isoWeekday(onDate))) continue;
    if (holidaySet.has(onDate)) continue;
    count += 1;
  }
  return count;
}

export function unusedMinutesInPeriod(rows: readonly YearEndLedgerRow[], periodYear: number): number {
  return rows
    .filter((row) => isLiveLedgerRow(row) && row.periodYear === periodYear)
    .reduce((sum, row) => sum + row.minutes, 0);
}

/** Forfeit stays off unless the policy flag is on. Unused above the cap is not deleted. */
export function computeCarryAndForfeit(input: {
  unusedMinutes: number;
  carryoverMaxMinutes: number | null;
  allowForfeit: boolean;
}): { carryMinutes: number; forfeitMinutes: number } {
  const unused = Math.max(input.unusedMinutes, 0);
  const carry =
    input.carryoverMaxMinutes == null ? unused : Math.min(unused, input.carryoverMaxMinutes);
  if (!input.allowForfeit) {
    return { carryMinutes: carry, forfeitMinutes: 0 };
  }
  return { carryMinutes: carry, forfeitMinutes: unused - carry };
}

export function planSickAllotment(input: {
  grantMinutes: number;
  startDate: string;
  year: number;
  weekendDays?: readonly number[];
  holidays?: ReadonlySet<string>;
}): { minutes: number; effectiveOn: string } | null {
  const { yearStart, yearEnd } = calendarYearBounds(input.year);
  if (input.startDate > yearEnd) return null;
  if (input.grantMinutes <= 0) return null;
  if (input.startDate <= yearStart) {
    return { minutes: input.grantMinutes, effectiveOn: yearStart };
  }
  const weekends = input.weekendDays ?? DEFAULT_WEEKEND_DAYS;
  const holidays = input.holidays ?? new Set<string>();
  const yearWorking = countWorkingDays(yearStart, yearEnd, weekends, holidays);
  if (yearWorking === 0) return null;
  const remaining = countWorkingDays(input.startDate, yearEnd, weekends, holidays);
  const minutes = Math.trunc((input.grantMinutes * remaining) / yearWorking);
  if (minutes <= 0) return null;
  return { minutes, effectiveOn: input.startDate };
}

function policyById(world: YearEndWorld): Map<string, YearEndPolicy> {
  return new Map(world.policies.map((policy) => [policy.id, policy]));
}

function typeById(world: YearEndWorld): Map<string, YearEndLeaveType> {
  return new Map(world.leaveTypes.map((type) => [type.id, type]));
}

function liveGrantExists(
  rows: readonly YearEndLedgerRow[],
  employeeId: string,
  leaveTypeId: string,
  kind: string,
  periodYear: number,
  effectiveOn: string,
): boolean {
  return rows.some(
    (row) =>
      isLiveLedgerRow(row) &&
      row.kind === kind &&
      (row.employeeId ?? employeeId) === employeeId &&
      (row.leaveTypeId ?? leaveTypeId) === leaveTypeId &&
      row.periodYear === periodYear &&
      row.effectiveOn === effectiveOn,
  );
}

function hasImportOpening(
  rows: readonly YearEndLedgerRow[],
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
): boolean {
  return rows.some((row) => {
    if (!isLiveLedgerRow(row)) return false;
    if (row.kind !== "adjustment") return false;
    if ((row.employeeId ?? employeeId) !== employeeId) return false;
    if ((row.leaveTypeId ?? leaveTypeId) !== leaveTypeId) return false;
    if (row.periodYear !== periodYear) return false;
    return (row.reason ?? "").startsWith("import:");
  });
}

function scopedLedger(
  world: YearEndWorld,
  employeeId: string,
  leaveTypeId: string,
): YearEndLedgerRow[] {
  return world.ledger.filter((row) => {
    if (row.employeeId && row.employeeId !== employeeId) return false;
    if (row.leaveTypeId && row.leaveTypeId !== leaveTypeId) return false;
    return true;
  });
}

export function canStartClose(status: string | null | undefined): boolean {
  return status === "open" || status === "closing";
}

export function canFirstYearOpen(periods: Map<number, PolicyPeriodStatus>, year: number): string | null {
  const status = periods.get(year) ?? null;
  if (status === "closed" || status === "closing") {
    return `period ${year} is ${status}; reopen or wait`;
  }
  const otherBusy = [...periods.entries()].some(
    ([otherYear, otherStatus]) =>
      otherYear !== year && (otherStatus === "open" || otherStatus === "closing" || otherStatus === "closed"),
  );
  if (otherBusy) {
    return `cannot first-year open ${year} while another year is already in use; close ${year - 1} instead`;
  }
  if (status === "open") return null;
  const anyBusy = [...periods.values()].some(
    (otherStatus) => otherStatus === "open" || otherStatus === "closing" || otherStatus === "closed",
  );
  if (anyBusy) {
    return `cannot first-year open ${year} while another year is already in use`;
  }
  return null;
}

function previewKey(employeeId: string, leaveTypeId: string): string {
  return `${employeeId}\0${leaveTypeId}`;
}

function emptyPreview(employee: YearEndEmployee, leaveType: YearEndLeaveType): ClosePreviewRow {
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    leaveTypeId: leaveType.id,
    leaveTypeCode: leaveType.code,
    unusedMinutes: 0,
    carryMinutes: 0,
    forfeitMinutes: 0,
    sickGrantMinutes: 0,
    writesVacationLump: false,
  };
}

export function planYearClose(
  world: YearEndWorld,
  year: number,
  options: CloseYearOptions = {},
): { ok: true; plan: ClosePlan } | { ok: false; error: string } {
  if (!Number.isInteger(year)) {
    return { ok: false, error: "year must be an integer" };
  }
  const status = world.periods.get(year) ?? null;
  if (!canStartClose(status)) {
    return { ok: false, error: `period ${year} must be open (or closing) to close` };
  }
  const nextYear = year + 1;
  const nextStatus = world.periods.get(nextYear);
  if (nextStatus === "closed" || nextStatus === "closing") {
    return { ok: false, error: `period ${nextYear} is ${nextStatus}; cannot open it from close` };
  }

  const { yearEnd } = calendarYearBounds(year);
  const nextStart = `${nextYear}-01-01`;
  const policies = policyById(world);
  const types = typeById(world);
  const previewByKey = new Map<string, ClosePreviewRow>();
  const posts: PlannedLedgerPost[] = [];
  const reason = closeReason(year);

  for (const employee of world.employees) {
    if (!employee.active) continue;
    if (employee.endDate != null && employee.endDate < nextStart) continue;

    const covering = world.assignments.filter(
      (assignment) => assignment.employeeId === employee.id && assignmentCovers(assignment, yearEnd),
    );
    for (const assignment of covering) {
      const policy = policies.get(assignment.policyId);
      const leaveType = types.get(assignment.leaveTypeId);
      if (!policy || !leaveType || !leaveType.consumesBalance) continue;

      const rows = scopedLedger(world, employee.id, leaveType.id);
      const unused = unusedMinutesInPeriod(rows, year);
      const { carryMinutes, forfeitMinutes } = computeCarryAndForfeit({
        unusedMinutes: unused,
        carryoverMaxMinutes: policy.carryoverMaxMinutes,
        allowForfeit: Boolean(policy.allowForfeit && options.acknowledgeForfeit),
      });

      if (
        carryMinutes > 0 &&
        !liveGrantExists(world.ledger, employee.id, leaveType.id, "carryover", nextYear, nextStart)
      ) {
        posts.push({
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          kind: "carryover",
          minutes: carryMinutes,
          effectiveOn: nextStart,
          reason,
        });
      }
      if (forfeitMinutes > 0) {
        posts.push({
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          kind: "forfeit",
          minutes: forfeitMinutes,
          effectiveOn: yearEnd,
          reason,
        });
      }

      previewByKey.set(previewKey(employee.id, leaveType.id), {
        ...emptyPreview(employee, leaveType),
        unusedMinutes: unused,
        carryMinutes,
        forfeitMinutes,
      });
    }
  }

  for (const employee of world.employees) {
    if (!employeeActiveOn(employee, nextStart)) continue;
    const covering = world.assignments.filter(
      (assignment) => assignment.employeeId === employee.id && assignmentCovers(assignment, nextStart),
    );
    for (const assignment of covering) {
      const policy = policies.get(assignment.policyId);
      const leaveType = types.get(assignment.leaveTypeId);
      if (!policy || !leaveType || !leaveType.consumesBalance) continue;
      if (policy.grantMode !== "lump_sum" || policy.grantMinutes == null) continue;
      if (hasImportOpening(world.ledger, employee.id, leaveType.id, nextYear)) continue;
      const planned = planSickAllotment({
        grantMinutes: policy.grantMinutes,
        startDate: employee.startDate,
        year: nextYear,
        weekendDays: world.weekendDays,
        holidays: world.holidays,
      });
      if (!planned) continue;
      if (liveGrantExists(world.ledger, employee.id, leaveType.id, "grant_lump", nextYear, planned.effectiveOn)) {
        continue;
      }
      posts.push({
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        kind: "grant_lump",
        minutes: planned.minutes,
        effectiveOn: planned.effectiveOn,
        reason,
      });
      const key = previewKey(employee.id, leaveType.id);
      const existing = previewByKey.get(key) ?? emptyPreview(employee, leaveType);
      previewByKey.set(key, { ...existing, sickGrantMinutes: planned.minutes });
    }
  }

  return {
    ok: true,
    plan: { year, nextYear, preview: [...previewByKey.values()], posts },
  };
}

export function planFirstYearOpen(
  world: YearEndWorld,
  year: number,
): { ok: true; posts: PlannedLedgerPost[] } | { ok: false; error: string } {
  if (!Number.isInteger(year)) {
    return { ok: false, error: "year must be an integer" };
  }
  const blocked = canFirstYearOpen(world.periods, year);
  if (blocked) return { ok: false, error: blocked };

  const { yearStart } = calendarYearBounds(year);
  const policies = policyById(world);
  const types = typeById(world);
  const posts: PlannedLedgerPost[] = [];
  const reason = openReason(year);

  for (const employee of world.employees) {
    if (!employeeActiveOn(employee, employee.startDate > yearStart ? employee.startDate : yearStart)) {
      continue;
    }
    const covering = world.assignments.filter((assignment) => {
      if (assignment.employeeId !== employee.id) return false;
      const onDate = employee.startDate > yearStart ? employee.startDate : yearStart;
      return assignmentCovers(assignment, onDate);
    });
    for (const assignment of covering) {
      const policy = policies.get(assignment.policyId);
      const leaveType = types.get(assignment.leaveTypeId);
      if (!policy || !leaveType || !leaveType.consumesBalance) continue;
      if (policy.grantMode !== "lump_sum" || policy.grantMinutes == null) continue;
      if (hasImportOpening(world.ledger, employee.id, leaveType.id, year)) continue;
      const planned = planSickAllotment({
        grantMinutes: policy.grantMinutes,
        startDate: employee.startDate,
        year,
        weekendDays: world.weekendDays,
        holidays: world.holidays,
      });
      if (!planned) continue;
      if (liveGrantExists(world.ledger, employee.id, leaveType.id, "grant_lump", year, planned.effectiveOn)) {
        continue;
      }
      posts.push({
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        kind: "grant_lump",
        minutes: planned.minutes,
        effectiveOn: planned.effectiveOn,
        reason,
      });
    }
  }

  return { ok: true, posts };
}

export function liveNonCloseActivity(
  rows: readonly YearEndLedgerRow[],
  year: number,
  closedYear: number,
): YearEndLedgerRow[] {
  return rows.filter(
    (row) =>
      isLiveLedgerRow(row) && row.periodYear === year && !isCloseTagged(row.reason ?? null, closedYear),
  );
}

export function planReopen(
  world: YearEndWorld,
  year: number,
): { ok: true; reverseIds: string[] } | { ok: false; error: string } {
  if (world.periods.get(year) !== "closed") {
    return { ok: false, error: `period ${year} must be closed to reopen` };
  }
  const nextYear = year + 1;
  const nextStatus = world.periods.get(nextYear);
  if (nextStatus === "closed" || nextStatus === "closing") {
    return { ok: false, error: `period ${nextYear} is ${nextStatus}; cannot reopen ${year}` };
  }
  const blockers = liveNonCloseActivity(world.ledger, nextYear, year);
  if (blockers.length > 0) {
    return {
      ok: false,
      error: `period ${nextYear} has live activity that was not created by close:${year}`,
    };
  }
  const reverseIds: string[] = [];
  for (const row of world.ledger) {
    if (!row.id) continue;
    if (row.reversedAt != null) continue;
    if (row.kind === "reversal") continue;
    if (!isCloseTagged(row.reason ?? null, year)) continue;
    reverseIds.push(row.id);
  }
  return { ok: true, reverseIds };
}

export function applyPlannedPostsToMemory(
  ledger: MemoryLedger,
  posts: readonly PlannedLedgerPost[],
  actorId: string,
): void {
  for (const post of posts) {
    ledger.post({
      employeeId: post.employeeId,
      leaveTypeId: post.leaveTypeId,
      kind: post.kind,
      minutes: post.minutes,
      effectiveOn: post.effectiveOn,
      reason: post.reason,
      createdBy: actorId,
    });
  }
}

export function applyClosePeriods(periods: Map<number, PolicyPeriodStatus>, year: number): void {
  periods.set(year, "closed");
  periods.set(year + 1, "open");
}

export function applyReopenPeriods(periods: Map<number, PolicyPeriodStatus>, year: number): void {
  periods.set(year, "open");
  const nextYear = year + 1;
  if (periods.get(nextYear) === "open") {
    periods.set(nextYear, "future");
  }
}

export function applyOpenPeriod(periods: Map<number, PolicyPeriodStatus>, year: number): void {
  periods.set(year, "open");
  if (!periods.has(year + 1)) {
    periods.set(year + 1, "future");
  }
}

function lockEmployeeIds(world: YearEndWorld): string[] {
  return [...new Set(world.employees.map((employee) => employee.id))].sort();
}

export function executeCloseOnWorld(
  world: YearEndWorld,
  year: number,
  options: CloseYearOptions = {},
  hooks?: { afterMarkClosing?: (world: YearEndWorld) => void },
): { ok: true; plan: ClosePlan } | { ok: false; error: string } {
  const pre = planYearClose(world, year, options);
  if (!pre.ok) return pre;
  world.periods.set(year, "closing");
  hooks?.afterMarkClosing?.(world);
  const planned = planYearClose(world, year, options);
  if (!planned.ok) return planned;
  applyClosePeriods(world.periods, year);
  return planned;
}

export function executeReopenOnWorld(
  world: YearEndWorld,
  year: number,
  hooks?: { afterPlan?: (world: YearEndWorld) => void },
): { ok: true; reverseIds: string[] } | { ok: false; error: string } {
  const first = planReopen(world, year);
  if (!first.ok) return first;
  hooks?.afterPlan?.(world);
  const planned = planReopen(world, year);
  if (!planned.ok) return planned;
  applyReopenPeriods(world.periods, year);
  return planned;
}

export function snapshotPayload(orgId: string, plan: ClosePlan, closedAt: string) {
  return {
    orgId,
    year: plan.year,
    nextYear: plan.nextYear,
    closedAt,
    preview: plan.preview,
    posts: plan.posts.map((post) => ({
      employeeId: post.employeeId,
      leaveTypeId: post.leaveTypeId,
      kind: post.kind,
      minutes: post.minutes,
      effectiveOn: post.effectiveOn,
      reason: post.reason,
    })),
  };
}

export async function writeYearEndSnapshotFile(
  orgId: string,
  year: number,
  payload: unknown,
  dir = path.join(tmpdir(), "aa-leave-year-end"),
): Promise<{ sha256: string; path: string }> {
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const sha256 = createHash("sha256").update(body).digest("hex");
  const filePath = path.join(dir, `${orgId}-${year}-${sha256.slice(0, 12)}.json`);
  await writeFile(filePath, body, "utf8");
  return { sha256, path: filePath };
}

type LoadedWorld = YearEndWorld & { timezone: string };

function mapPeriodStatus(status: string): PolicyPeriodStatus {
  if (!isPeriodStatus(status)) {
    throw new Error(`invalid period status: ${status}`);
  }
  return status;
}

export async function loadYearEndWorld(db: LedgerDb, orgId: string): Promise<LoadedWorld> {
  const [org] = await db
    .select({
      id: organizations.id,
      timezone: organizations.timezone,
      weekendDays: organizations.weekendDays,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) {
    throw new Error(`organization not found: ${orgId}`);
  }

  const [periodRows, employeeRows, typeRows, policyRows, assignmentRows, holidayRows, ledgerRows] =
    await Promise.all([
      db
        .select({
          year: policyPeriods.year,
          status: policyPeriods.status,
        })
        .from(policyPeriods)
        .where(eq(policyPeriods.orgId, orgId)),
      db
        .select({
          id: employees.id,
          name: employees.name,
          active: employees.active,
          startDate: employees.startDate,
          endDate: employees.endDate,
        })
        .from(employees)
        .where(eq(employees.orgId, orgId)),
      db
        .select({
          id: leaveTypes.id,
          code: leaveTypes.code,
          consumesBalance: leaveTypes.consumesBalance,
        })
        .from(leaveTypes)
        .where(eq(leaveTypes.orgId, orgId)),
      db
        .select({
          id: policies.id,
          leaveTypeId: policies.leaveTypeId,
          grantMode: policies.grantMode,
          grantMinutes: policies.grantMinutes,
          periodicCadence: policies.periodicCadence,
          periodicMinutes: policies.periodicMinutes,
          carryoverMaxMinutes: policies.carryoverMaxMinutes,
          allowForfeit: policies.allowForfeit,
          accrualStopMinutes: policies.accrualStopMinutes,
        })
        .from(policies)
        .where(eq(policies.orgId, orgId)),
      db
        .select({
          employeeId: policyAssignments.employeeId,
          policyId: policyAssignments.policyId,
          leaveTypeId: policyAssignments.leaveTypeId,
          validFrom: policyAssignments.validFrom,
          validTo: policyAssignments.validTo,
        })
        .from(policyAssignments)
        .innerJoin(employees, eq(employees.id, policyAssignments.employeeId))
        .where(eq(employees.orgId, orgId)),
      db
        .select({ onDate: holidays.onDate })
        .from(holidays)
        .where(eq(holidays.orgId, orgId)),
      db
        .select({
          id: ledgerEntries.id,
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
        .innerJoin(employees, eq(employees.id, ledgerEntries.employeeId))
        .where(eq(employees.orgId, orgId)),
    ]);

  const periods = new Map<number, PolicyPeriodStatus>();
  for (const row of periodRows) {
    periods.set(row.year, mapPeriodStatus(row.status));
  }

  return {
    orgId,
    timezone: org.timezone,
    weekendDays: org.weekendDays ?? DEFAULT_WEEKEND_DAYS,
    holidays: new Set(holidayRows.map((row) => row.onDate)),
    periods,
    employees: employeeRows,
    leaveTypes: typeRows,
    policies: policyRows,
    assignments: assignmentRows,
    ledger: ledgerRows,
  };
}

export async function listPolicyPeriods(orgId: string, db: LedgerDb = getDb()) {
  return db
    .select({
      year: policyPeriods.year,
      status: policyPeriods.status,
      closedAt: policyPeriods.closedAt,
      closedBy: policyPeriods.closedBy,
    })
    .from(policyPeriods)
    .where(eq(policyPeriods.orgId, orgId))
    .orderBy(policyPeriods.year);
}

export async function previewCloseYear(
  orgId: string,
  year: number,
  options: CloseYearOptions = {},
  db: LedgerDb = getDb(),
): Promise<{ ok: true; plan: ClosePlan } | { ok: false; error: string; status: 400 }> {
  const world = await loadYearEndWorld(db, orgId);
  const planned = planYearClose(world, year, options);
  if (!planned.ok) return { ok: false, error: planned.error, status: 400 };
  return { ok: true, plan: planned.plan };
}

async function upsertPeriod(
  tx: LedgerDb,
  orgId: string,
  year: number,
  status: PolicyPeriodStatus,
  closed?: { at: Date; by: string } | null,
): Promise<void> {
  await tx
    .insert(policyPeriods)
    .values({
      orgId,
      year,
      status,
      closedAt: closed?.at ?? null,
      closedBy: closed?.by ?? null,
    })
    .onConflictDoUpdate({
      target: [policyPeriods.orgId, policyPeriods.year],
      set: {
        status,
        closedAt: closed === undefined ? sql`${policyPeriods.closedAt}` : (closed?.at ?? null),
        closedBy: closed === undefined ? sql`${policyPeriods.closedBy}` : (closed?.by ?? null),
      },
    });
}

async function persistSnapshot(
  tx: LedgerDb,
  orgId: string,
  year: number,
  sha256: string,
  filePath: string,
  createdAt: Date,
): Promise<void> {
  await tx
    .insert(yearEndSnapshots)
    .values({ orgId, year, sha256, path: filePath, createdAt })
    .onConflictDoUpdate({
      target: [yearEndSnapshots.orgId, yearEndSnapshots.year],
      set: { sha256, path: filePath, createdAt },
    });
}

async function freezeEntriesInYear(tx: LedgerDb, orgId: string, year: number, at: Date): Promise<void> {
  const { yearStart, yearEnd } = calendarYearBounds(year);
  const ids = await tx
    .select({ id: leaveEntries.id })
    .from(leaveEntries)
    .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
    .where(
      and(
        eq(employees.orgId, orgId),
        lte(leaveEntries.startDate, yearEnd),
        gte(leaveEntries.endDate, yearStart),
        inArray(leaveEntries.status, ["approved", "rejected", "cancelled"]),
        isNull(leaveEntries.immutableAt),
      ),
    );
  if (ids.length === 0) return;
  await tx
    .update(leaveEntries)
    .set({ immutableAt: at })
    .where(
      inArray(
        leaveEntries.id,
        ids.map((row) => row.id),
      ),
    );
}

async function postPlanned(
  tx: LedgerSession,
  posts: readonly PlannedLedgerPost[],
  actorId: string,
  createdAt: Date,
): Promise<void> {
  const seen = new Set<string>();
  for (const post of posts) {
    if (!seen.has(post.employeeId)) {
      await acquireEmployeeLock(tx, post.employeeId);
      seen.add(post.employeeId);
    }
    const input: PostLedgerInput = {
      employeeId: post.employeeId,
      leaveTypeId: post.leaveTypeId,
      kind: post.kind,
      minutes: post.minutes,
      effectiveOn: post.effectiveOn,
      reason: post.reason,
      createdBy: actorId,
      createdAt,
    };
    await postLedgerEntryInTx(tx, input);
  }
}

export async function closeYear(
  orgId: string,
  year: number,
  actorId: string,
  options: CloseYearOptions = {},
  db: LedgerSession = getDb(),
  writeAudit: AuditWriter = writeAuditEvent,
  hooks: CloseYearHooks = {},
): Promise<YearEndResult & { plan?: ClosePlan; snapshot?: { sha256: string; path: string } }> {
  const preWorld = await loadYearEndWorld(db, orgId);
  const pre = planYearClose(preWorld, year, options);
  if (!pre.ok) return { ok: false, error: pre.error, status: 400 };

  try {
    await db.transaction(async (tx) => {
      await upsertPeriod(tx, orgId, year, "closing");
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "close failed";
    return { ok: false, error: message, status: 409 };
  }

  await hooks.afterMarkClosing?.();

  const closedAt = new Date();
  let plan: ClosePlan | undefined;
  let snapshot: { sha256: string; path: string } | undefined;

  try {
    await db.transaction(async (tx) => {
      for (const employeeId of lockEmployeeIds(preWorld)) {
        await acquireEmployeeLock(tx, employeeId);
      }
      const world = await loadYearEndWorld(tx, orgId);
      const planned = planYearClose(world, year, options);
      if (!planned.ok) {
        throw new Error(planned.error);
      }
      plan = planned.plan;
      const payload = snapshotPayload(orgId, plan, closedAt.toISOString());
      snapshot = await writeYearEndSnapshotFile(orgId, year, payload);
      await postPlanned(tx, plan.posts, actorId, closedAt);
      await upsertPeriod(tx, orgId, year, "closed", { at: closedAt, by: actorId });
      await upsertPeriod(tx, orgId, year + 1, "open", null);
      await persistSnapshot(tx, orgId, year, snapshot.sha256, snapshot.path, closedAt);
      await freezeEntriesInYear(tx, orgId, year, closedAt);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "close failed";
    return { ok: false, error: message, status: 409 };
  }

  await tryWriteAudit(writeAudit, {
    actorId,
    action: "year_end.closed",
    entityType: "policy_period",
    entityId: orgId,
    after: { year, nextYear: year + 1, snapshot, posts: plan?.posts.length ?? 0 },
  });
  return { ok: true, plan, snapshot };
}

export async function reopenYear(
  orgId: string,
  year: number,
  actorId: string,
  db: LedgerSession = getDb(),
  writeAudit: AuditWriter = writeAuditEvent,
  hooks: ReopenYearHooks = {},
): Promise<YearEndResult & { reversed?: number }> {
  const preWorld = await loadYearEndWorld(db, orgId);
  const pre = planReopen(preWorld, year);
  if (!pre.ok) return { ok: false, error: pre.error, status: 400 };

  await hooks.afterPlan?.();

  let reversed = 0;
  try {
    await db.transaction(async (tx) => {
      for (const employeeId of lockEmployeeIds(preWorld)) {
        await acquireEmployeeLock(tx, employeeId);
      }
      const world = await loadYearEndWorld(tx, orgId);
      const planned = planReopen(world, year);
      if (!planned.ok) {
        throw new Error(planned.error);
      }
      reversed = planned.reverseIds.length;
      for (const id of planned.reverseIds) {
        await reverseLedgerEntryInTx(tx, {
          id,
          createdBy: actorId,
          reason: reopenReason(year),
        });
      }
      await upsertPeriod(tx, orgId, year, "open", null);
      if (world.periods.get(year + 1) === "open") {
        await upsertPeriod(tx, orgId, year + 1, "future", null);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "reopen failed";
    return { ok: false, error: message, status: 409 };
  }

  await tryWriteAudit(writeAudit, {
    actorId,
    action: "year_end.reopened",
    entityType: "policy_period",
    entityId: orgId,
    after: { year, reversed },
  });
  return { ok: true, reversed };
}

export async function openFirstYear(
  orgId: string,
  year: number,
  actorId: string,
  db: LedgerSession = getDb(),
  writeAudit: AuditWriter = writeAuditEvent,
): Promise<YearEndResult & { posts?: number }> {
  const world = await loadYearEndWorld(db, orgId);
  const planned = planFirstYearOpen(world, year);
  if (!planned.ok) return { ok: false, error: planned.error, status: 400 };

  const createdAt = new Date();
  try {
    await db.transaction(async (tx) => {
      await upsertPeriod(tx, orgId, year, "open", null);
      await upsertPeriod(tx, orgId, year + 1, "future", null);
      await postPlanned(tx, planned.posts, actorId, createdAt);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "open failed";
    return { ok: false, error: message, status: 409 };
  }

  await tryWriteAudit(writeAudit, {
    actorId,
    action: "year_end.opened",
    entityType: "policy_period",
    entityId: orgId,
    after: { year, posts: planned.posts.length },
  });
  return { ok: true, posts: planned.posts.length };
}

