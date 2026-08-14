import { desc, eq } from "drizzle-orm";
import { resolveMeEmployeeId } from "@/lib/leave-fields";
import { withRunningRemaining } from "@/lib/ledger-remaining";
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
import { loadOrgHolidays } from "@/server/holidays/import";
import { asOfDateString, getBalance, type Balance } from "@/server/ledger/balance";
import { canCancelEntry, type AuthzActor } from "@/server/authz";
import { getDb } from "@/server/db";

export type MyLeaveType = {
  id: string;
  code: string;
  name: string;
  consumesBalance: boolean;
  unlimited: boolean;
  legalUnit: string;
  minIncrementMinutes: number | null;
  negativeAllowed: boolean;
  negativeFloorMinutes: number | null;
};

export type MyBalanceRow = MyLeaveType & {
  balance: Balance;
};

export type MyLedgerRow = {
  id: string;
  leaveTypeId: string;
  leaveTypeName: string;
  kind: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  reversedAt: Date | null;
  reason: string | null;
  createdAt: Date;
  remainingMinutes: number | null;
};

export type MyEntryRow = {
  id: string;
  leaveTypeId: string;
  leaveTypeName: string;
  intent: string;
  status: string;
  startDate: string;
  endDate: string;
  portion: string;
  totalMinutes: number;
  note: string | null;
  canCancel: boolean;
};

export type MyLeavePage = {
  employeeName: string;
  today: string;
  workdayMinutes: number;
  weekendDays: number[];
  holidays: string[];
  types: MyLeaveType[];
  balances: MyBalanceRow[];
  ledger: MyLedgerRow[];
  entries: MyEntryRow[];
};

export async function loadMyLeavePage(actor: AuthzActor | null): Promise<MyLeavePage> {
  const resolved = resolveMeEmployeeId(actor);
  if (!resolved.ok) {
    throw new Error(resolved.code);
  }
  const employeeId = resolved.employeeId;
  const db = getDb();
  const empRows = await db
    .select({
      id: employees.id,
      name: employees.name,
      orgId: employees.orgId,
      workdayMinutes: employees.workdayMinutes,
      timezone: organizations.timezone,
      orgWorkdayMinutes: organizations.standardWorkdayMinutes,
      weekendDays: organizations.weekendDays,
    })
    .from(employees)
    .innerJoin(organizations, eq(employees.orgId, organizations.id))
    .where(eq(employees.id, employeeId))
    .limit(1);
  const emp = empRows[0];
  if (!emp) {
    throw new Error(`employee not found: ${employeeId}`);
  }

  const [assigned, orgTypes, holidayRows, ledgerRows, entryRows, periodRows] = await Promise.all([
    db
      .select({
        id: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        consumesBalance: leaveTypes.consumesBalance,
        unlimited: leaveTypes.unlimited,
        legalUnit: leaveTypes.legalUnit,
        minIncrementMinutes: policies.minIncrementMinutes,
        negativeAllowed: policies.negativeAllowed,
        negativeFloorMinutes: policies.negativeFloorMinutes,
      })
      .from(policyAssignments)
      .innerJoin(leaveTypes, eq(policyAssignments.leaveTypeId, leaveTypes.id))
      .innerJoin(policies, eq(policyAssignments.policyId, policies.id))
      .where(eq(policyAssignments.employeeId, employeeId))
      .orderBy(leaveTypes.code),
    db
      .select({
        id: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        consumesBalance: leaveTypes.consumesBalance,
        unlimited: leaveTypes.unlimited,
        legalUnit: leaveTypes.legalUnit,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.orgId, emp.orgId)),
    loadOrgHolidays(emp.orgId),
    db
      .select({
        id: ledgerEntries.id,
        leaveTypeId: ledgerEntries.leaveTypeId,
        kind: ledgerEntries.kind,
        minutes: ledgerEntries.minutes,
        effectiveOn: ledgerEntries.effectiveOn,
        periodYear: ledgerEntries.periodYear,
        reversedAt: ledgerEntries.reversedAt,
        reason: ledgerEntries.reason,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.employeeId, employeeId))
      .orderBy(desc(ledgerEntries.effectiveOn), desc(ledgerEntries.createdAt)),
    db
      .select({
        id: leaveEntries.id,
        leaveTypeId: leaveEntries.leaveTypeId,
        intent: leaveEntries.intent,
        status: leaveEntries.status,
        startDate: leaveEntries.startDate,
        endDate: leaveEntries.endDate,
        portion: leaveEntries.portion,
        totalMinutes: leaveEntries.totalMinutes,
        note: leaveEntries.note,
        immutableAt: leaveEntries.immutableAt,
      })
      .from(leaveEntries)
      .where(eq(leaveEntries.employeeId, employeeId))
      .orderBy(desc(leaveEntries.startDate), desc(leaveEntries.createdAt)),
    db
      .select({ year: policyPeriods.year, status: policyPeriods.status })
      .from(policyPeriods)
      .where(eq(policyPeriods.orgId, emp.orgId)),
  ]);

  const typeById = new Map(orgTypes.map((type) => [type.id, type]));
  const today = asOfDateString(new Date(), emp.timezone);
  const workdayMinutes = emp.workdayMinutes ?? emp.orgWorkdayMinutes;
  const periodYear = Number(today.slice(0, 4));
  const byYear = new Map(periodRows.map((row) => [row.year, row.status]));

  const assignedById = new Map(assigned.map((type) => [type.id, type]));
  const stripIds = new Set<string>([
    ...assigned.map((type) => type.id),
    ...ledgerRows.map((row) => row.leaveTypeId),
  ]);

  const balances: MyBalanceRow[] = [];
  for (const id of stripIds) {
    const assignedType = assignedById.get(id);
    const orgType = typeById.get(id);
    if (!assignedType && !orgType) continue;
    const type: MyLeaveType = assignedType ?? {
      id,
      code: orgType!.code,
      name: orgType!.name,
      consumesBalance: orgType!.consumesBalance,
      unlimited: orgType!.unlimited,
      legalUnit: orgType!.legalUnit,
      minIncrementMinutes: null,
      negativeAllowed: false,
      negativeFloorMinutes: null,
    };
    const balance = await getBalance(db, {
      employeeId,
      leaveTypeId: type.id,
      asOf: today,
      timeZone: emp.timezone,
    });
    balances.push({ ...type, balance });
  }

  const ledger = withRunningRemaining(
    ledgerRows.map((row) => ({
      ...row,
      leaveTypeName: typeById.get(row.leaveTypeId)?.name ?? row.leaveTypeId,
    })),
    periodYear,
  );

  return {
    employeeName: emp.name,
    today,
    workdayMinutes,
    weekendDays: emp.weekendDays,
    holidays: holidayRows.map((row) => row.onDate),
    types: assigned,
    balances,
    ledger,
    entries: entryRows.map((row) => {
      const years = new Set([Number(row.startDate.slice(0, 4)), Number(row.endDate.slice(0, 4))]);
      const open = [...years].every((year) => byYear.get(year) === "open");
      return {
        id: row.id,
        leaveTypeId: row.leaveTypeId,
        leaveTypeName: typeById.get(row.leaveTypeId)?.name ?? row.leaveTypeId,
        intent: row.intent,
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        portion: row.portion,
        totalMinutes: row.totalMinutes,
        note: row.note,
        canCancel: canCancelEntry(
          actor,
          {
            employeeId,
            status: row.status,
            immutableAt: row.immutableAt,
            startDate: row.startDate,
          },
          { open, today },
        ),
      };
    }),
  };
}
