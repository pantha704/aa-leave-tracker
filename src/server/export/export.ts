import { asc, eq } from "drizzle-orm";
import {
  employees,
  holidays,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  policies,
  policyAssignments,
} from "@/db/schema";
import { isUuid } from "@/server/admin/employees";
import { parseIsoDate } from "@/server/holidays/csv";
import {
  asOfDateString,
  calendarYearBounds,
  computeBalance,
  type LedgerSumRow,
  type PendingEntrySumRow,
} from "@/server/ledger/balance";
import { getDb } from "@/server/db";
import { minutesToHours, toCsv } from "./csv";
import { exportFilename, terminationFilename, type ExportKind } from "./kinds";
import {
  computeTerminationMinutes,
  orgGlobalHolidayDates,
  terminationRowsToCsv,
  type TerminationGrantMode,
} from "./termination";

export type ExportOrg = {
  timezone: string;
  weekendDays: number[];
};

export type ExportEmployee = {
  id: string;
  email: string;
  name: string;
  startDate: string;
  endDate: string | null;
};

export type ExportLeaveType = {
  id: string;
  code: string;
  consumesBalance: boolean;
  unlimited: boolean;
};

export type ExportPolicyRow = {
  employeeId: string;
  leaveTypeId: string;
  grantMode: string;
  grantMinutes: number | null;
  validFrom: string;
  validTo: string | null;
};

export type ExportLedgerRow = LedgerSumRow & {
  employeeId: string;
  leaveTypeId: string;
  email: string;
  leaveTypeCode: string;
  reason: string | null;
  reversedAt: Date | null;
  kind: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
};

export type ExportEntryRow = {
  employeeId: string;
  email: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  totalMinutes: number;
  portion: string;
  note: string | null;
  status: string;
  intent: string;
};

export type ExportSnapshot = {
  org: ExportOrg;
  employees: ExportEmployee[];
  leaveTypes: ExportLeaveType[];
  policies: ExportPolicyRow[];
  holidays: { onDate: string; region: string | null }[];
  ledger: ExportLedgerRow[];
  entries: ExportEntryRow[];
};

export type ExportStore = {
  loadSnapshot: (orgId: string) => Promise<ExportSnapshot | null>;
};

export type BuildExportInput = {
  orgId: string;
  kind: ExportKind;
  asOf?: string;
  endDate?: string;
  employeeId?: string;
  now?: Date;
  store?: ExportStore;
};

export type BuildExportResult =
  | { ok: true; csv: string; filename: string; rowCount: number; kind: ExportKind }
  | { ok: false; status: 400 | 404; error: string };

function asGrantMode(value: string): TerminationGrantMode {
  if (value === "lump_sum" || value === "periodic" || value === "hourly_worked" || value === "none") {
    return value;
  }
  return "periodic";
}

function policyOnDate(rows: readonly ExportPolicyRow[], employeeId: string, leaveTypeId: string, onDate: string) {
  return (
    rows.find(
      (row) =>
        row.employeeId === employeeId &&
        row.leaveTypeId === leaveTypeId &&
        row.validFrom <= onDate &&
        (row.validTo == null || row.validTo >= onDate),
    ) ?? null
  );
}

export function pgExportStore(db: ReturnType<typeof getDb> = getDb()): ExportStore {
  return {
    async loadSnapshot(orgId) {
      if (!isUuid(orgId)) return null;
      const [org] = await db
        .select({
          timezone: organizations.timezone,
          weekendDays: organizations.weekendDays,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) return null;

      const [people, types, assigned, holidayRows, ledger, entries] = await Promise.all([
        db
          .select({
            id: employees.id,
            email: employees.email,
            name: employees.name,
            startDate: employees.startDate,
            endDate: employees.endDate,
          })
          .from(employees)
          .where(eq(employees.orgId, orgId))
          .orderBy(asc(employees.email)),
        db
          .select({
            id: leaveTypes.id,
            code: leaveTypes.code,
            consumesBalance: leaveTypes.consumesBalance,
            unlimited: leaveTypes.unlimited,
          })
          .from(leaveTypes)
          .where(eq(leaveTypes.orgId, orgId))
          .orderBy(asc(leaveTypes.code)),
        db
          .select({
            employeeId: policyAssignments.employeeId,
            leaveTypeId: policyAssignments.leaveTypeId,
            grantMode: policies.grantMode,
            grantMinutes: policies.grantMinutes,
            validFrom: policyAssignments.validFrom,
            validTo: policyAssignments.validTo,
          })
          .from(policyAssignments)
          .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
          .innerJoin(employees, eq(employees.id, policyAssignments.employeeId))
          .where(eq(employees.orgId, orgId)),
        db
          .select({ onDate: holidays.onDate, region: holidays.region })
          .from(holidays)
          .where(eq(holidays.orgId, orgId)),
        db
          .select({
            employeeId: ledgerEntries.employeeId,
            leaveTypeId: ledgerEntries.leaveTypeId,
            email: employees.email,
            leaveTypeCode: leaveTypes.code,
            kind: ledgerEntries.kind,
            minutes: ledgerEntries.minutes,
            effectiveOn: ledgerEntries.effectiveOn,
            periodYear: ledgerEntries.periodYear,
            reason: ledgerEntries.reason,
            reversedAt: ledgerEntries.reversedAt,
          })
          .from(ledgerEntries)
          .innerJoin(employees, eq(employees.id, ledgerEntries.employeeId))
          .innerJoin(leaveTypes, eq(leaveTypes.id, ledgerEntries.leaveTypeId))
          .where(eq(employees.orgId, orgId))
          .orderBy(
            asc(employees.email),
            asc(leaveTypes.code),
            asc(ledgerEntries.effectiveOn),
            asc(ledgerEntries.createdAt),
          ),
        db
          .select({
            employeeId: leaveEntries.employeeId,
            email: employees.email,
            leaveTypeCode: leaveTypes.code,
            startDate: leaveEntries.startDate,
            endDate: leaveEntries.endDate,
            totalMinutes: leaveEntries.totalMinutes,
            portion: leaveEntries.portion,
            note: leaveEntries.note,
            status: leaveEntries.status,
            intent: leaveEntries.intent,
          })
          .from(leaveEntries)
          .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEntries.leaveTypeId))
          .where(eq(employees.orgId, orgId))
          .orderBy(asc(employees.email), asc(leaveEntries.startDate), asc(leaveEntries.createdAt)),
      ]);

      return {
        org,
        employees: people,
        leaveTypes: types,
        policies: assigned,
        holidays: holidayRows,
        ledger,
        entries,
      };
    },
  };
}

const defaultStore: ExportStore = {
  loadSnapshot: (orgId) => pgExportStore().loadSnapshot(orgId),
};

function filterPeople(snapshot: ExportSnapshot, employeeId?: string): ExportEmployee[] {
  if (!employeeId) return snapshot.employees;
  return snapshot.employees.filter((person) => person.id === employeeId);
}

export function balancesToCsv(
  snapshot: ExportSnapshot,
  people: readonly ExportEmployee[],
  asOf: string,
): string {
  const headers = [
    "email",
    "name",
    "leave_type",
    "as_of",
    "granted_hours",
    "taken_hours",
    "scheduled_hours",
    "requested_hours",
    "remaining_hours",
    "available_hours",
  ];
  const types = snapshot.leaveTypes.filter((type) => type.consumesBalance && !type.unlimited);
  const pendingByKey = new Map<string, PendingEntrySumRow[]>();
  for (const entry of snapshot.entries) {
    if (entry.status !== "pending") continue;
    const key = `${entry.employeeId}:${entry.leaveTypeCode}`;
    const list = pendingByKey.get(key) ?? [];
    list.push({
      status: entry.status,
      totalMinutes: entry.totalMinutes,
      startDate: entry.startDate,
      endDate: entry.endDate,
      employeeId: entry.employeeId,
    });
    pendingByKey.set(key, list);
  }

  const rows: (string | number)[][] = [];
  for (const person of people) {
    for (const type of types) {
      const ledger = snapshot.ledger.filter(
        (row) => row.employeeId === person.id && row.leaveTypeId === type.id,
      );
      const pending = pendingByKey.get(`${person.id}:${type.code}`) ?? [];
      const asOfLedger = ledger.filter((row) => row.effectiveOn <= asOf);
      const split = computeBalance({
        rows: ledger,
        pendingEntries: pending,
        asOf,
        timeZone: snapshot.org.timezone,
      });
      const cut = computeBalance({
        rows: asOfLedger,
        pendingEntries: [],
        asOf,
        timeZone: snapshot.org.timezone,
      });
      rows.push([
        person.email,
        person.name,
        type.code,
        asOf,
        minutesToHours(cut.grantedMinutes),
        minutesToHours(split.takenMinutes),
        minutesToHours(split.scheduledMinutes),
        minutesToHours(split.requestedMinutes),
        minutesToHours(cut.remainingMinutes),
        minutesToHours(cut.remainingMinutes - split.requestedMinutes),
      ]);
    }
  }
  return toCsv(headers, rows);
}

export function entriesToCsv(entries: readonly ExportEntryRow[]): string {
  return toCsv(
    ["email", "leave_type", "start", "end", "hours", "portion", "note", "status", "intent"],
    entries.map((entry) => [
      entry.email,
      entry.leaveTypeCode,
      entry.startDate,
      entry.endDate,
      minutesToHours(entry.totalMinutes),
      entry.portion,
      entry.note,
      entry.status,
      entry.intent,
    ]),
  );
}

export function ledgerToCsv(rows: readonly ExportLedgerRow[]): string {
  return toCsv(
    [
      "email",
      "leave_type",
      "kind",
      "minutes",
      "hours",
      "effective_on",
      "period_year",
      "reason",
      "reversed_at",
    ],
    rows.map((row) => [
      row.email,
      row.leaveTypeCode,
      row.kind,
      row.minutes,
      minutesToHours(row.minutes),
      row.effectiveOn,
      row.periodYear,
      row.reason,
      row.reversedAt ? row.reversedAt.toISOString() : "",
    ]),
  );
}

export function buildTerminationCsv(
  snapshot: ExportSnapshot,
  people: readonly ExportEmployee[],
  endDateByEmployee: (person: ExportEmployee) => string,
): string {
  const types = snapshot.leaveTypes.filter((type) => type.consumesBalance && !type.unlimited);
  const holidaySet = orgGlobalHolidayDates(snapshot.holidays);
  const weekendDays = snapshot.org.weekendDays?.length ? snapshot.org.weekendDays : [6, 7];
  const rows = [];
  for (const person of people) {
    const endDate = endDateByEmployee(person);
    const periodYear = Number(endDate.slice(0, 4));
    const { yearStart, yearEnd } = calendarYearBounds(periodYear);
    for (const type of types) {
      const policy = policyOnDate(snapshot.policies, person.id, type.id, endDate);
      const computed = computeTerminationMinutes({
        grantMode: asGrantMode(policy?.grantMode ?? "periodic"),
        grantMinutes: policy?.grantMinutes ?? null,
        rows: snapshot.ledger.filter((row) => row.employeeId === person.id && row.leaveTypeId === type.id),
        endDate,
        periodYear,
        periodStart: yearStart,
        periodEnd: yearEnd,
        employeeStartDate: person.startDate,
        weekendDays,
        holidays: holidaySet,
      });
      rows.push({
        email: person.email,
        leaveType: type.code,
        endDate,
        ledgerRemainingMinutes: computed.ledgerRemainingMinutes,
        proRataEarnedToEndDateMinutes: computed.proRataEarnedToEndDateMinutes,
      });
    }
  }
  return terminationRowsToCsv(rows);
}

export async function buildExport(input: BuildExportInput): Promise<BuildExportResult> {
  if (input.employeeId && !isUuid(input.employeeId)) {
    return { ok: false, status: 404, error: "employee not found" };
  }
  const asOfRaw = input.asOf?.trim() || undefined;
  if (asOfRaw && !parseIsoDate(asOfRaw)) {
    return { ok: false, status: 400, error: "invalid date" };
  }
  const endDateRaw = input.endDate?.trim() || undefined;
  if (endDateRaw && !parseIsoDate(endDateRaw)) {
    return { ok: false, status: 400, error: "invalid date" };
  }

  const store = input.store ?? defaultStore;
  const snapshot = await store.loadSnapshot(input.orgId);
  if (!snapshot) {
    return { ok: false, status: 404, error: "organization not found" };
  }

  const people = filterPeople(snapshot, input.employeeId);
  if (input.employeeId && people.length === 0) {
    return { ok: false, status: 404, error: "employee not found" };
  }

  const asOf = asOfDateString(asOfRaw ?? input.now ?? new Date(), snapshot.org.timezone);

  let csv: string;
  let filename: string;
  if (input.kind === "balances") {
    csv = balancesToCsv(snapshot, people, asOf);
    filename = exportFilename("balances", asOf);
  } else if (input.kind === "entries") {
    const entries = input.employeeId
      ? snapshot.entries.filter((row) => row.employeeId === input.employeeId)
      : snapshot.entries;
    csv = entriesToCsv(entries);
    filename = exportFilename("entries", asOf);
  } else if (input.kind === "ledger") {
    const ledger = input.employeeId
      ? snapshot.ledger.filter((row) => row.employeeId === input.employeeId)
      : snapshot.ledger;
    csv = ledgerToCsv(ledger);
    filename = exportFilename("ledger", asOf);
  } else {
    const endDateFor = (person: ExportEmployee) => endDateRaw ?? person.endDate ?? asOf;
    csv = buildTerminationCsv(snapshot, people, endDateFor);
    filename = terminationFilename(people.map(endDateFor));
  }

  const rowCount = Math.max(csv.trimEnd().split("\n").length - 1, 0);
  return {
    ok: true,
    csv,
    filename,
    rowCount,
    kind: input.kind,
  };
}
