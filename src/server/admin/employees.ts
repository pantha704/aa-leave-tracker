import { and, desc, eq, ilike, inArray, isNull, max, ne, or, sql } from "drizzle-orm";
import {
  employees,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  policies,
  policyAssignments,
  policyPeriods,
} from "@/db/schema";
import { DEMO_VACATION_TYPE_CODE } from "@/db/demo-policy";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { canAdjustLedger, type AuthzActor } from "@/server/authz";
import { getDb } from "@/server/db";
import { parseIsoDate } from "@/server/holidays/csv";
import {
  asOfDateString,
  computeBalance,
  type Balance,
  type LedgerSumRow,
  type PendingEntrySumRow,
} from "@/server/ledger/balance";
import { postLedgerEntry, type LedgerRow, type PostLedgerInput } from "@/server/ledger/post";
import { isInvalidDate, isInvalidText } from "@/server/pg-error";
import { APP_READONLY_MESSAGE, isAppReadonly as orgIsAppReadonly } from "@/server/settings";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_HOURS = /^-?\d+(\.\d+)?$/;

export function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function hoursToMinutes(hours: string): number {
  return Math.round(Number(hours) * 60);
}

export type RosterEmployee = {
  id: string;
  name: string;
  email: string;
  role: string;
  employmentType: string;
  active: boolean;
  startDate: string;
  remainingVacationMinutes: number | null;
  remainingVacationHours: string | null;
  lastEntryDate: string | null;
};

export type EmployeeIdentity = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  managerId: string | null;
  startDate: string;
  endDate: string | null;
  employmentType: string;
  workdayMinutes: number | null;
  orgWorkdayMinutes: number;
  timezone: string;
  active: boolean;
};

export type BalanceStripRow = {
  leaveTypeId: string;
  code: string;
  name: string;
  workdayMinutes: number;
  balance: Balance;
};

export type FileLedgerLine = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  kind: string;
  minutes: number;
  hours: string;
  effectiveOn: string;
  periodYear: number;
  reason: string | null;
  reversedAt: Date | null;
  runningRemainingMinutes: number | null;
};

export type FileLeaveEntry = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  intent: string;
  status: string;
  immutableAt: Date | null;
  startDate: string;
  endDate: string;
  portion: string;
  totalMinutes: number;
  note: string | null;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FileAssignment = {
  id: string;
  policyId: string;
  policyName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  validFrom: string;
  validTo: string | null;
};

export type PolicyOption = {
  id: string;
  name: string;
  leaveTypeId: string;
  leaveTypeCode: string;
};

export type EmployeeFile = {
  employee: EmployeeIdentity;
  balances: BalanceStripRow[];
  ledger: FileLedgerLine[];
  entries: FileLeaveEntry[];
  assignments: FileAssignment[];
  policies: PolicyOption[];
};

export type PendingEntryRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  totalMinutes: number;
  intent: string;
};

export type AdjustInput = {
  leaveTypeId: string;
  minutes: number;
  effectiveOn: string;
  reason: string;
};

export type AssignPolicyInput = {
  policyId: string;
  validFrom: string;
  validTo?: string | null;
};

export type AdminFail = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 423;
  error: string;
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type LeaveEntryOrgRef = { entryId: string; employeeId: string };

function writeInputError(err: unknown): AdminFail | null {
  if (isInvalidText(err)) return { ok: false, status: 404, error: "employee not found" };
  if (isInvalidDate(err)) return { ok: false, status: 400, error: "invalid date" };
  return null;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function firstString(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  return record[key] ?? record[snake(key)];
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

export function parseAdjustInput(raw: unknown):
  | { ok: true; value: AdjustInput }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "invalid body" };
  }
  const record = raw as Record<string, unknown>;
  const leaveTypeId = String(firstString(raw, "leaveTypeId") ?? "").trim();
  const effectiveOn = String(firstString(raw, "effectiveOn") ?? "").trim();
  const reason = String(firstString(raw, "reason") ?? "").trim();
  if (!isUuid(leaveTypeId)) return { ok: false, error: "leaveTypeId must be a uuid" };
  const effective = parseIsoDate(effectiveOn);
  if (!effective) return { ok: false, error: "effectiveOn must be YYYY-MM-DD" };
  if (!reason) return { ok: false, error: "reason is required" };

  let minutes: number;
  if (record.minutes != null && record.minutes !== "") {
    minutes = typeof record.minutes === "number" ? record.minutes : Number(record.minutes);
    if (!Number.isInteger(minutes)) return { ok: false, error: "minutes must be an integer" };
  } else if (record.hours != null && record.hours !== "") {
    const hours = String(record.hours).trim();
    if (!DECIMAL_HOURS.test(hours) || !Number.isFinite(Number(hours))) {
      return { ok: false, error: "hours must be a decimal string" };
    }
    minutes = hoursToMinutes(hours);
  } else {
    return { ok: false, error: "minutes is required" };
  }
  if (minutes === 0) return { ok: false, error: "minutes must be non-zero" };

  return { ok: true, value: { leaveTypeId, minutes, effectiveOn: effective, reason } };
}

export function parseAssignPolicyInput(raw: unknown):
  | { ok: true; value: AssignPolicyInput }
  | { ok: false; error: string } {
  const policyId = String(firstString(raw, "policyId") ?? "").trim();
  const validFrom = String(firstString(raw, "validFrom") ?? "").trim();
  const validToRaw = firstString(raw, "validTo");
  const validTo =
    validToRaw == null || String(validToRaw).trim() === "" ? null : String(validToRaw).trim();
  if (!isUuid(policyId)) return { ok: false, error: "policyId must be a uuid" };
  const from = parseIsoDate(validFrom);
  if (!from) return { ok: false, error: "validFrom must be YYYY-MM-DD" };
  const to = validTo == null ? null : parseIsoDate(validTo);
  if (validTo && !to) return { ok: false, error: "validTo must be YYYY-MM-DD" };
  if (to && to < from) return { ok: false, error: "validTo must be on or after validFrom" };
  return { ok: true, value: { policyId, validFrom: from, validTo: to } };
}

export function buildRosterRows(input: {
  people: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    employmentType: string;
    active: boolean;
    startDate: string;
  }>;
  vacationTypeId: string | null;
  ledger: LedgerSumRow[];
  pending: PendingEntrySumRow[];
  lastEntryByEmployee: Map<string, string | null>;
  asOf: string;
  timeZone: string;
}): RosterEmployee[] {
  return input.people.map((person) => {
    let remainingVacationMinutes: number | null = null;
    if (input.vacationTypeId) {
      remainingVacationMinutes = computeBalance({
        rows: input.ledger,
        pendingEntries: input.pending,
        asOf: input.asOf,
        timeZone: input.timeZone,
        employeeId: person.id,
        leaveTypeId: input.vacationTypeId,
      }).remainingMinutes;
    }
    return {
      ...person,
      remainingVacationMinutes,
      remainingVacationHours:
        remainingVacationMinutes == null ? null : minutesToHours(remainingVacationMinutes),
      lastEntryDate: input.lastEntryByEmployee.get(person.id) ?? null,
    };
  });
}

export function withRunningRemaining(
  lines: Array<Omit<FileLedgerLine, "runningRemainingMinutes" | "hours">>,
): FileLedgerLine[] {
  const remaining = new Map<string, number>();
  const chronological = [...lines].sort((a, b) => {
    if (a.effectiveOn !== b.effectiveOn) return a.effectiveOn.localeCompare(b.effectiveOn);
    return a.id.localeCompare(b.id);
  });
  const remainingById = new Map<string, number>();
  for (const line of chronological) {
    if (line.reversedAt != null || line.kind === "reversal") {
      remainingById.set(line.id, remaining.get(line.leaveTypeId) ?? 0);
      continue;
    }
    const next = (remaining.get(line.leaveTypeId) ?? 0) + line.minutes;
    remaining.set(line.leaveTypeId, next);
    remainingById.set(line.id, next);
  }
  return lines.map((line) => ({
    ...line,
    hours: minutesToHours(line.minutes),
    runningRemainingMinutes: remainingById.get(line.id) ?? null,
  }));
}

export type EmployeeStore = {
  loadOrg: (orgId: string) => Promise<{ timezone: string; standardWorkdayMinutes: number } | null>;
  listPeople: (
    orgId: string,
    q?: string,
  ) => Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      employmentType: string;
      active: boolean;
      startDate: string;
    }>
  >;
  findVacationTypeId: (orgId: string) => Promise<string | null>;
  loadVacationLedger: (employeeIds: string[], vacationTypeId: string) => Promise<LedgerSumRow[]>;
  loadVacationPending: (
    employeeIds: string[],
    vacationTypeId: string,
  ) => Promise<PendingEntrySumRow[]>;
  loadLastEntryDates: (employeeIds: string[]) => Promise<Map<string, string | null>>;
  getEmployee: (orgId: string, employeeId: string) => Promise<EmployeeIdentity | null>;
  listLeaveTypes: (orgId: string) => Promise<Array<{ id: string; code: string; name: string }>>;
  loadEmployeeLedger: (employeeId: string) => Promise<
    Array<
      Omit<FileLedgerLine, "hours" | "runningRemainingMinutes"> & {
        reversedAt: Date | null;
      }
    >
  >;
  loadEmployeeEntries: (employeeId: string) => Promise<FileLeaveEntry[]>;
  loadAssignments: (employeeId: string) => Promise<FileAssignment[]>;
  listPolicies: (orgId: string) => Promise<PolicyOption[]>;
  loadTypeLedger: (employeeId: string, leaveTypeId: string) => Promise<LedgerSumRow[]>;
  loadTypePending: (employeeId: string, leaveTypeId: string) => Promise<PendingEntrySumRow[]>;
  leaveTypeInOrg: (orgId: string, leaveTypeId: string) => Promise<boolean>;
  periodStatus: (orgId: string, year: number) => Promise<string | null>;
  postAdjustment: (input: PostLedgerInput) => Promise<LedgerRow>;
  getPolicyRef: (
    orgId: string,
    policyId: string,
  ) => Promise<{ id: string; leaveTypeId: string } | null>;
  upsertAssignment: (row: {
    employeeId: string;
    policyId: string;
    leaveTypeId: string;
    validFrom: string;
    validTo: string | null;
  }) => Promise<FileAssignment>;
  countPending: (orgId: string) => Promise<number>;
  listPending: (orgId: string) => Promise<PendingEntryRow[]>;
  findLeaveEntryInOrg: (orgId: string, entryId: string) => Promise<LeaveEntryOrgRef | null>;
  isAppReadonly: (orgId: string) => Promise<boolean>;
};

const assignmentReturning = {
  id: policyAssignments.id,
  policyId: policyAssignments.policyId,
  leaveTypeId: policyAssignments.leaveTypeId,
  validFrom: policyAssignments.validFrom,
  validTo: policyAssignments.validTo,
};

export function pgEmployeeStore(db: ReturnType<typeof getDb> = getDb()): EmployeeStore {
  return {
    async loadOrg(orgId) {
      const [row] = await db
        .select({
          timezone: organizations.timezone,
          standardWorkdayMinutes: organizations.standardWorkdayMinutes,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      return row ?? null;
    },
    async listPeople(orgId, q) {
      const pattern = q?.trim() ? `%${escapeIlike(q.trim())}%` : null;
      const rows = await db
        .select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          role: employees.role,
          employmentType: employees.employmentType,
          active: employees.active,
          startDate: employees.startDate,
        })
        .from(employees)
        .where(
          pattern
            ? and(
                eq(employees.orgId, orgId),
                or(ilike(employees.name, pattern), ilike(employees.email, pattern)),
              )
            : eq(employees.orgId, orgId),
        )
        .orderBy(employees.name);
      return rows;
    },
    async findVacationTypeId(orgId) {
      const [row] = await db
        .select({ id: leaveTypes.id })
        .from(leaveTypes)
        .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.code, DEMO_VACATION_TYPE_CODE)))
        .limit(1);
      return row?.id ?? null;
    },
    async loadVacationLedger(employeeIds, vacationTypeId) {
      if (employeeIds.length === 0) return [];
      return db
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
            inArray(ledgerEntries.employeeId, employeeIds),
            eq(ledgerEntries.leaveTypeId, vacationTypeId),
          ),
        );
    },
    async loadVacationPending(employeeIds, vacationTypeId) {
      if (employeeIds.length === 0) return [];
      return db
        .select({
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
            inArray(leaveEntries.employeeId, employeeIds),
            eq(leaveEntries.leaveTypeId, vacationTypeId),
            eq(leaveEntries.status, "pending"),
          ),
        );
    },
    async loadLastEntryDates(employeeIds) {
      const map = new Map<string, string | null>();
      if (employeeIds.length === 0) return map;
      const rows = await db
        .select({
          employeeId: leaveEntries.employeeId,
          lastEntryDate: max(leaveEntries.endDate),
        })
        .from(leaveEntries)
        .where(
          and(inArray(leaveEntries.employeeId, employeeIds), eq(leaveEntries.status, "approved")),
        )
        .groupBy(leaveEntries.employeeId);
      for (const row of rows) {
        map.set(row.employeeId, row.lastEntryDate);
      }
      return map;
    },
    async getEmployee(orgId, employeeId) {
      if (!isUuid(orgId) || !isUuid(employeeId)) return null;
      const [row] = await db
        .select({
          id: employees.id,
          orgId: employees.orgId,
          name: employees.name,
          email: employees.email,
          role: employees.role,
          managerId: employees.managerId,
          startDate: employees.startDate,
          endDate: employees.endDate,
          employmentType: employees.employmentType,
          workdayMinutes: employees.workdayMinutes,
          orgWorkdayMinutes: organizations.standardWorkdayMinutes,
          timezone: organizations.timezone,
          active: employees.active,
        })
        .from(employees)
        .innerJoin(organizations, eq(organizations.id, employees.orgId))
        .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)))
        .limit(1);
      return row ?? null;
    },
    async listLeaveTypes(orgId) {
      return db
        .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name })
        .from(leaveTypes)
        .where(eq(leaveTypes.orgId, orgId))
        .orderBy(leaveTypes.code);
    },
    async loadEmployeeLedger(employeeId) {
      return db
        .select({
          id: ledgerEntries.id,
          leaveTypeId: ledgerEntries.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          kind: ledgerEntries.kind,
          minutes: ledgerEntries.minutes,
          effectiveOn: ledgerEntries.effectiveOn,
          periodYear: ledgerEntries.periodYear,
          reason: ledgerEntries.reason,
          reversedAt: ledgerEntries.reversedAt,
        })
        .from(ledgerEntries)
        .innerJoin(leaveTypes, eq(leaveTypes.id, ledgerEntries.leaveTypeId))
        .where(eq(ledgerEntries.employeeId, employeeId))
        .orderBy(desc(ledgerEntries.effectiveOn), desc(ledgerEntries.createdAt));
    },
    async loadEmployeeEntries(employeeId) {
      return db
        .select({
          id: leaveEntries.id,
          leaveTypeId: leaveEntries.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          intent: leaveEntries.intent,
          status: leaveEntries.status,
          immutableAt: leaveEntries.immutableAt,
          startDate: leaveEntries.startDate,
          endDate: leaveEntries.endDate,
          portion: leaveEntries.portion,
          totalMinutes: leaveEntries.totalMinutes,
          note: leaveEntries.note,
          adminNote: leaveEntries.adminNote,
          createdAt: leaveEntries.createdAt,
          updatedAt: leaveEntries.updatedAt,
        })
        .from(leaveEntries)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEntries.leaveTypeId))
        .where(eq(leaveEntries.employeeId, employeeId))
        .orderBy(desc(leaveEntries.startDate), desc(leaveEntries.createdAt));
    },
    async loadAssignments(employeeId) {
      return db
        .select({
          id: policyAssignments.id,
          policyId: policyAssignments.policyId,
          policyName: policies.name,
          leaveTypeId: policyAssignments.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          validFrom: policyAssignments.validFrom,
          validTo: policyAssignments.validTo,
        })
        .from(policyAssignments)
        .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, policyAssignments.leaveTypeId))
        .where(eq(policyAssignments.employeeId, employeeId))
        .orderBy(leaveTypes.code);
    },
    async listPolicies(orgId) {
      return db
        .select({
          id: policies.id,
          name: policies.name,
          leaveTypeId: policies.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
        })
        .from(policies)
        .innerJoin(leaveTypes, eq(leaveTypes.id, policies.leaveTypeId))
        .where(eq(policies.orgId, orgId))
        .orderBy(policies.name);
    },
    async loadTypeLedger(employeeId, leaveTypeId) {
      return db
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
            eq(ledgerEntries.employeeId, employeeId),
            eq(ledgerEntries.leaveTypeId, leaveTypeId),
            isNull(ledgerEntries.reversedAt),
            ne(ledgerEntries.kind, "reversal"),
          ),
        );
    },
    async loadTypePending(employeeId, leaveTypeId) {
      return db
        .select({
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
            eq(leaveEntries.employeeId, employeeId),
            eq(leaveEntries.leaveTypeId, leaveTypeId),
            eq(leaveEntries.status, "pending"),
          ),
        );
    },
    async leaveTypeInOrg(orgId, leaveTypeId) {
      if (!isUuid(orgId) || !isUuid(leaveTypeId)) return false;
      const [row] = await db
        .select({ id: leaveTypes.id })
        .from(leaveTypes)
        .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.orgId, orgId)))
        .limit(1);
      return Boolean(row);
    },
    async periodStatus(orgId, year) {
      const [row] = await db
        .select({ status: policyPeriods.status })
        .from(policyPeriods)
        .where(and(eq(policyPeriods.orgId, orgId), eq(policyPeriods.year, year)))
        .limit(1);
      return row?.status ?? null;
    },
    async postAdjustment(input) {
      return postLedgerEntry(db, input);
    },
    async getPolicyRef(orgId, policyId) {
      if (!isUuid(orgId) || !isUuid(policyId)) return null;
      const [row] = await db
        .select({ id: policies.id, leaveTypeId: policies.leaveTypeId })
        .from(policies)
        .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
        .limit(1);
      return row ?? null;
    },
    async upsertAssignment(row) {
      const proposedId = crypto.randomUUID();
      const [saved] = await db
        .insert(policyAssignments)
        .values({ id: proposedId, ...row })
        .onConflictDoUpdate({
          target: [policyAssignments.employeeId, policyAssignments.leaveTypeId],
          set: {
            policyId: row.policyId,
            validFrom: row.validFrom,
            validTo: row.validTo,
          },
        })
        .returning(assignmentReturning);
      const [named] = await db
        .select({
          policyName: policies.name,
          leaveTypeCode: leaveTypes.code,
        })
        .from(policies)
        .innerJoin(leaveTypes, eq(leaveTypes.id, policies.leaveTypeId))
        .where(eq(policies.id, saved.policyId))
        .limit(1);
      return {
        ...saved,
        policyName: named?.policyName ?? "",
        leaveTypeCode: named?.leaveTypeCode ?? "",
      };
    },
    async countPending(orgId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(leaveEntries)
        .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
        .where(and(eq(employees.orgId, orgId), eq(leaveEntries.status, "pending")));
      return Number(row?.n ?? 0);
    },
    async findLeaveEntryInOrg(orgId, entryId) {
      if (!isUuid(orgId) || !isUuid(entryId)) return null;
      const [row] = await db
        .select({
          entryId: leaveEntries.id,
          employeeId: leaveEntries.employeeId,
        })
        .from(leaveEntries)
        .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
        .where(and(eq(leaveEntries.id, entryId), eq(employees.orgId, orgId)))
        .limit(1);
      return row ?? null;
    },
    async listPending(orgId) {
      return db
        .select({
          id: leaveEntries.id,
          employeeId: leaveEntries.employeeId,
          employeeName: employees.name,
          leaveTypeId: leaveEntries.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          startDate: leaveEntries.startDate,
          endDate: leaveEntries.endDate,
          totalMinutes: leaveEntries.totalMinutes,
          intent: leaveEntries.intent,
        })
        .from(leaveEntries)
        .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEntries.leaveTypeId))
        .where(and(eq(employees.orgId, orgId), eq(leaveEntries.status, "pending")))
        .orderBy(leaveEntries.startDate, employees.name);
    },
    async isAppReadonly(orgId) {
      return orgIsAppReadonly(orgId);
    },
  };
}

export async function listRoster(input: {
  orgId: string;
  q?: string;
  asOf?: Date | string;
  store?: EmployeeStore;
}): Promise<RosterEmployee[]> {
  const store = input.store ?? pgEmployeeStore();
  const org = await store.loadOrg(input.orgId);
  if (!org) return [];
  const people = await store.listPeople(input.orgId, input.q);
  const vacationTypeId = await store.findVacationTypeId(input.orgId);
  const ids = people.map((person) => person.id);
  const [ledger, pending, lastEntryByEmployee] = await Promise.all([
    vacationTypeId ? store.loadVacationLedger(ids, vacationTypeId) : Promise.resolve([]),
    vacationTypeId ? store.loadVacationPending(ids, vacationTypeId) : Promise.resolve([]),
    store.loadLastEntryDates(ids),
  ]);
  const asOf = asOfDateString(input.asOf ?? new Date(), org.timezone);
  return buildRosterRows({
    people,
    vacationTypeId,
    ledger,
    pending,
    lastEntryByEmployee,
    asOf,
    timeZone: org.timezone,
  });
}

export async function loadEmployeeFile(input: {
  orgId: string;
  employeeId: string;
  asOf?: Date | string;
  store?: EmployeeStore;
}): Promise<EmployeeFile | null> {
  if (!isUuid(input.orgId) || !isUuid(input.employeeId)) return null;
  const store = input.store ?? pgEmployeeStore();
  const employee = await store.getEmployee(input.orgId, input.employeeId);
  if (!employee) return null;
  const [types, ledgerRaw, entries, assignments, policyOptions] = await Promise.all([
    store.listLeaveTypes(input.orgId),
    store.loadEmployeeLedger(employee.id),
    store.loadEmployeeEntries(employee.id),
    store.loadAssignments(employee.id),
    store.listPolicies(input.orgId),
  ]);
  const asOf = asOfDateString(input.asOf ?? new Date(), employee.timezone);
  const workdayMinutes = employee.workdayMinutes ?? employee.orgWorkdayMinutes;
  const balances: BalanceStripRow[] = [];
  for (const type of types) {
    const [rows, pending] = await Promise.all([
      store.loadTypeLedger(employee.id, type.id),
      store.loadTypePending(employee.id, type.id),
    ]);
    balances.push({
      leaveTypeId: type.id,
      code: type.code,
      name: type.name,
      workdayMinutes,
      balance: computeBalance({
        rows,
        pendingEntries: pending,
        asOf,
        timeZone: employee.timezone,
        employeeId: employee.id,
        leaveTypeId: type.id,
      }),
    });
  }
  return {
    employee,
    balances,
    ledger: withRunningRemaining(ledgerRaw),
    entries,
    assignments,
    policies: policyOptions,
  };
}

export async function countPendingEntries(
  orgId: string,
  store: EmployeeStore = pgEmployeeStore(),
): Promise<number> {
  return store.countPending(orgId);
}

export async function listPendingEntries(
  orgId: string,
  store: EmployeeStore = pgEmployeeStore(),
): Promise<PendingEntryRow[]> {
  return store.listPending(orgId);
}

export async function findLeaveEntryInOrg(
  orgId: string,
  entryId: string,
  store: EmployeeStore = pgEmployeeStore(),
): Promise<LeaveEntryOrgRef | null> {
  if (!isUuid(orgId) || !isUuid(entryId)) return null;
  return store.findLeaveEntryInOrg(orgId, entryId);
}

export async function employeeInOrg(
  orgId: string,
  employeeId: string,
  store: EmployeeStore = pgEmployeeStore(),
): Promise<boolean> {
  if (!isUuid(orgId) || !isUuid(employeeId)) return false;
  return Boolean(await store.getEmployee(orgId, employeeId));
}

export async function postAdjustment(input: {
  actor: AuthzActor | null;
  orgId: string;
  employeeId: string;
  raw: unknown;
  store?: EmployeeStore;
  writeAudit?: AuditWriter;
}): Promise<{ ok: true; row: LedgerRow } | AdminFail> {
  if (!input.actor) return { ok: false, status: 401, error: "unauthenticated" };
  if (!canAdjustLedger(input.actor)) return { ok: false, status: 403, error: "forbidden" };

  if (!isUuid(input.employeeId)) return { ok: false, status: 404, error: "employee not found" };

  const parsed = parseAdjustInput(input.raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const store = input.store ?? pgEmployeeStore();
  if (await store.isAppReadonly(input.orgId)) {
    return { ok: false, status: 423, error: APP_READONLY_MESSAGE };
  }
  try {
    const employee = await store.getEmployee(input.orgId, input.employeeId);
    if (!employee) return { ok: false, status: 404, error: "employee not found" };
    if (!(await store.leaveTypeInOrg(input.orgId, parsed.value.leaveTypeId))) {
      return { ok: false, status: 400, error: "leave type not found in org" };
    }

    const year = Number(parsed.value.effectiveOn.slice(0, 4));
    const period = await store.periodStatus(input.orgId, year);
    if (period === "closed" || period === "closing") {
      return { ok: false, status: 409, error: "period is not open" };
    }

    const row = await store.postAdjustment({
      employeeId: employee.id,
      leaveTypeId: parsed.value.leaveTypeId,
      kind: "adjustment",
      minutes: parsed.value.minutes,
      effectiveOn: parsed.value.effectiveOn,
      reason: parsed.value.reason,
      createdBy: input.actor.id,
    });

    await tryWriteAudit(input.writeAudit ?? writeAuditEvent, {
      actorId: input.actor.id,
      action: "ledger.adjust",
      entityType: "ledger_entry",
      entityId: row.id,
      after: {
        employeeId: employee.id,
        leaveTypeId: parsed.value.leaveTypeId,
        minutes: row.minutes,
        effectiveOn: parsed.value.effectiveOn,
        reason: parsed.value.reason,
      },
    });

    return { ok: true, row };
  } catch (err) {
    const mapped = writeInputError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function assignEmployeePolicy(input: {
  actor: AuthzActor | null;
  orgId: string;
  employeeId: string;
  raw: unknown;
  store?: EmployeeStore;
  writeAudit?: AuditWriter;
}): Promise<{ ok: true; assignment: FileAssignment } | AdminFail> {
  if (!input.actor) return { ok: false, status: 401, error: "unauthenticated" };
  if (!canAdjustLedger(input.actor)) return { ok: false, status: 403, error: "forbidden" };

  if (!isUuid(input.employeeId)) return { ok: false, status: 404, error: "employee not found" };

  const parsed = parseAssignPolicyInput(input.raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const store = input.store ?? pgEmployeeStore();
  try {
    const employee = await store.getEmployee(input.orgId, input.employeeId);
    if (!employee) return { ok: false, status: 404, error: "employee not found" };
    const policy = await store.getPolicyRef(input.orgId, parsed.value.policyId);
    if (!policy) return { ok: false, status: 404, error: "policy not found" };

    const assignment = await store.upsertAssignment({
      employeeId: employee.id,
      policyId: policy.id,
      leaveTypeId: policy.leaveTypeId,
      validFrom: parsed.value.validFrom,
      validTo: parsed.value.validTo ?? null,
    });

    await tryWriteAudit(input.writeAudit ?? writeAuditEvent, {
      actorId: input.actor.id,
      action: "policy.assigned",
      entityType: "policy_assignment",
      entityId: assignment.id,
      after: assignment,
    });

    return { ok: true, assignment };
  } catch (err) {
    const mapped = writeInputError(err);
    if (mapped) return mapped;
    throw err;
  }
}
