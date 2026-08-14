import { desc, eq } from "drizzle-orm";
import {
  employees,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  policyAssignments,
} from "@/db/schema";
import { loadOrgHolidays } from "@/server/holidays/import";
import { asOfDateString, getBalance, type Balance } from "@/server/ledger/balance";
import { getDb } from "@/server/db";

export type MyLeaveType = {
  id: string;
  code: string;
  name: string;
  consumesBalance: boolean;
  unlimited: boolean;
  legalUnit: string;
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

export async function loadMyLeavePage(employeeId: string): Promise<MyLeavePage> {
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

  const [assigned, orgTypes, holidayRows, ledgerRows, entryRows] = await Promise.all([
    db
      .select({
        id: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        consumesBalance: leaveTypes.consumesBalance,
        unlimited: leaveTypes.unlimited,
        legalUnit: leaveTypes.legalUnit,
      })
      .from(policyAssignments)
      .innerJoin(leaveTypes, eq(policyAssignments.leaveTypeId, leaveTypes.id))
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
      })
      .from(leaveEntries)
      .where(eq(leaveEntries.employeeId, employeeId))
      .orderBy(desc(leaveEntries.startDate), desc(leaveEntries.createdAt)),
  ]);

  const typeById = new Map(orgTypes.map((type) => [type.id, type]));
  const today = asOfDateString(new Date(), emp.timezone);
  const workdayMinutes = emp.workdayMinutes ?? emp.orgWorkdayMinutes;

  const stripIds = new Set<string>([
    ...assigned.map((type) => type.id),
    ...ledgerRows.map((row) => row.leaveTypeId),
  ]);

  const balances: MyBalanceRow[] = [];
  for (const type of [...assigned, ...orgTypes.filter((type) => stripIds.has(type.id))]) {
    if (balances.some((row) => row.id === type.id)) continue;
    if (!stripIds.has(type.id)) continue;
    const balance = await getBalance(db, {
      employeeId,
      leaveTypeId: type.id,
      asOf: today,
      timeZone: emp.timezone,
    });
    balances.push({ ...type, balance });
  }

  return {
    employeeName: emp.name,
    today,
    workdayMinutes,
    weekendDays: emp.weekendDays,
    holidays: holidayRows.map((row) => row.onDate),
    types: assigned,
    balances,
    ledger: ledgerRows.map((row) => ({
      ...row,
      leaveTypeName: typeById.get(row.leaveTypeId)?.name ?? row.leaveTypeId,
    })),
    entries: entryRows.map((row) => ({
      ...row,
      leaveTypeName: typeById.get(row.leaveTypeId)?.name ?? row.leaveTypeId,
    })),
  };
}
