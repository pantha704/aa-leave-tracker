import {
  allocateMinutesAcrossDays,
  computeBalance,
  periodYearFromAsOf,
  type LedgerSumRow,
} from "@/server/ledger/balance";
import { expandToLeaveDays } from "@/server/leave/expand";
import { overlap } from "@/server/policy/rules/overlap";
import type { ExistingLeave, HolidayDate, LeaveStatus, Portion } from "@/server/policy/types";
import {
  IMPORT_OPENING_REASON,
  grantMapTargets,
  hoursToMinutes,
  importErrorsToCsv,
  mapImportCsv,
  remainingFromOpening,
  type ColumnMap,
  type ImportCsvError,
  type ImportKind,
  type MappedEntryRow,
  type MappedOpeningRow,
} from "./csv";

export type ImportEmployee = {
  id: string;
  email: string;
  name: string;
  startDate: string;
  workdayMinutes: number | null;
  orgWorkdayMinutes: number;
  weekendDays: number[];
};

export type ImportLeaveType = {
  id: string;
  code: string;
  name: string;
  consumesBalance: boolean;
};

export type ImportPolicy = {
  employeeId?: string;
  leaveTypeId: string;
  grantMode: string;
  grantMinutes: number | null;
};

export type ImportOccupancy = {
  employeeId: string;
  onDate: string;
  portion: Portion;
  consumesBalance: boolean;
  slotActive: boolean;
  status?: string;
};

export type ImportLedgerRow = LedgerSumRow & {
  reason?: string | null;
};

export type PlannedFirstYearGrant = {
  employeeId: string;
  leaveTypeId: string;
  periodYear: number;
  kind: "grant_lump";
};

export type ImportWorld = {
  employees: ImportEmployee[];
  leaveTypes: ImportLeaveType[];
  policies: ImportPolicy[];
  ledger: ImportLedgerRow[];
  holidays: HolidayDate[];
  occupancy: ImportOccupancy[];
  plannedFirstYearGrants: PlannedFirstYearGrant[];
};

export type PlannedLedgerPost = {
  line: number;
  employeeId: string;
  leaveTypeId: string;
  kind: "adjustment" | "usage";
  minutes: number;
  effectiveOn: string;
  periodYear: number;
  reason: string;
  leaveEntryId?: string;
};

export type PlannedHistoricalEntry = {
  line: number;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes: number | null;
  totalMinutes: number;
  note: string | null;
  status: LeaveStatus;
  intent: "log";
  days: Array<{ onDate: string; minutes: number; portion: Portion; consumesBalance: boolean }>;
};

export type SheetDiffRow = {
  line: number;
  email: string;
  leaveType: string;
  asOf: string;
  sheetRemainingMinutes: number;
  appRemainingMinutes: number;
  deltaMinutes: number;
};

export type DryRunOk = {
  ok: true;
  kind: ImportKind;
  headers: string[];
  errors: ImportCsvError[];
  warnings: ImportCsvError[];
  errorCsv: string;
  posts: PlannedLedgerPost[];
  entries: PlannedHistoricalEntry[];
  diffs: SheetDiffRow[];
};

export type DryRunFail = {
  ok: false;
  kind: ImportKind;
  headers: string[];
  errors: ImportCsvError[];
  warnings: ImportCsvError[];
  errorCsv: string;
  posts: PlannedLedgerPost[];
  entries: PlannedHistoricalEntry[];
  diffs: SheetDiffRow[];
};

export type DryRunResult = DryRunOk | DryRunFail;

export type DryRunOptions = {
  /**
   * Writer (3) skips Sick grant_lump when an `import:` adjustment exists.
   * Set false to treat a planned first-year allotment + opening as a double-grant.
   */
  skipFirstYearOnImport?: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeTypeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function findEmployee(world: ImportWorld, email: string): ImportEmployee | undefined {
  const want = normalizeEmail(email);
  return world.employees.find((row) => normalizeEmail(row.email) === want);
}

export function findLeaveType(world: ImportWorld, raw: string): ImportLeaveType | undefined {
  const want = normalizeTypeKey(raw);
  return world.leaveTypes.find(
    (row) => normalizeTypeKey(row.code) === want || normalizeTypeKey(row.name) === want,
  );
}

export function importOpeningKey(employeeId: string, leaveTypeId: string, periodYear: number): string {
  return `${employeeId}\0${leaveTypeId}\0${periodYear}`;
}

export function hasLiveGrantLump(
  ledger: readonly ImportLedgerRow[],
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
): boolean {
  return ledger.some(
    (row) =>
      row.reversedAt == null &&
      row.kind === "grant_lump" &&
      row.employeeId === employeeId &&
      row.leaveTypeId === leaveTypeId &&
      row.periodYear === periodYear,
  );
}

export function hasImportOpening(
  ledger: readonly ImportLedgerRow[],
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
): boolean {
  return ledger.some(
    (row) =>
      row.reversedAt == null &&
      row.kind === "adjustment" &&
      row.employeeId === employeeId &&
      row.leaveTypeId === leaveTypeId &&
      row.periodYear === periodYear &&
      (row.reason ?? "").startsWith("import:"),
  );
}

export function appRemainingMinutes(
  world: ImportWorld,
  employeeId: string,
  leaveTypeId: string,
  asOf: string,
): number {
  return computeBalance({
    rows: world.ledger,
    pendingEntries: [],
    asOf,
    timeZone: "UTC",
    periodYear: periodYearFromAsOf(asOf, "UTC"),
    employeeId,
    leaveTypeId,
  }).remainingMinutes;
}

function plannedFirstYearFor(
  world: ImportWorld,
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
): boolean {
  return world.plannedFirstYearGrants.some(
    (row) =>
      row.kind === "grant_lump" &&
      row.employeeId === employeeId &&
      row.leaveTypeId === leaveTypeId &&
      row.periodYear === periodYear,
  );
}

export function planFirstYearSickGrants(world: Omit<ImportWorld, "plannedFirstYearGrants">): PlannedFirstYearGrant[] {
  const planned: PlannedFirstYearGrant[] = [];
  const seen = new Set<string>();
  for (const employee of world.employees) {
    for (const policy of world.policies) {
      if (policy.grantMode !== "lump_sum") continue;
      if (policy.employeeId && policy.employeeId !== employee.id) continue;
      if (!policy.employeeId) continue;
      const leaveType = world.leaveTypes.find((row) => row.id === policy.leaveTypeId);
      if (!leaveType?.consumesBalance) continue;
      const periodYear = Number(employee.startDate.slice(0, 4));
      const key = importOpeningKey(employee.id, leaveType.id, periodYear);
      if (seen.has(key)) continue;
      if (hasImportOpening(world.ledger, employee.id, leaveType.id, periodYear)) continue;
      if (hasLiveGrantLump(world.ledger, employee.id, leaveType.id, periodYear)) continue;
      seen.add(key);
      planned.push({
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        periodYear,
        kind: "grant_lump",
      });
    }
  }
  return planned;
}

function failResult(
  kind: ImportKind,
  headers: string[],
  errors: ImportCsvError[],
  warnings: ImportCsvError[],
  extras: Partial<DryRunOk> = {},
): DryRunFail {
  return {
    ok: false,
    kind,
    headers,
    errors,
    warnings,
    errorCsv: importErrorsToCsv(errors),
    posts: extras.posts ?? [],
    entries: extras.entries ?? [],
    diffs: extras.diffs ?? [],
  };
}

function assertOpeningPostsAreAdjustments(posts: PlannedLedgerPost[]): ImportCsvError[] {
  return posts
    .filter((post) => post.kind !== "adjustment")
    .map((post) => ({
      line: post.line,
      code: "GRANT_KIND",
      message: "opening remaining must be adjustment, never grant_lump",
    }));
}

export function dryRunImport(
  csv: string,
  kind: ImportKind,
  map: ColumnMap,
  world: ImportWorld,
  options: DryRunOptions = {},
): DryRunResult {
  const skipFirstYearOnImport = options.skipFirstYearOnImport ?? true;
  const mapped = mapImportCsv(csv, kind, map);
  if (!mapped.ok) {
    return failResult(kind, mapped.headers, mapped.errors, []);
  }

  const errors = [...mapped.errors];
  const warnings = [...mapped.warnings];
  const grants = grantMapTargets(map);
  if (grants.length > 0) {
    errors.push({
      line: 1,
      field: grants[0],
      code: "GRANT_MAP",
      message: "import must not map a grant column; opening remaining is adjustment only",
    });
  }

  if (kind === "opening") {
    return dryRunOpening(mapped.headers, mapped.rows as MappedOpeningRow[], errors, warnings, world, {
      skipFirstYearOnImport,
    });
  }
  return dryRunEntries(mapped.headers, mapped.rows as MappedEntryRow[], errors, warnings, world);
}

function dryRunOpening(
  headers: string[],
  rows: MappedOpeningRow[],
  errors: ImportCsvError[],
  warnings: ImportCsvError[],
  world: ImportWorld,
  options: { skipFirstYearOnImport: boolean },
): DryRunResult {
  const posts: PlannedLedgerPost[] = [];
  const diffs: SheetDiffRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const employee = findEmployee(world, row.email);
    const leaveType = findLeaveType(world, row.leaveType);
    if (!employee) {
      errors.push({ line: row.line, field: "email", message: `unknown email: ${row.email}` });
      continue;
    }
    if (!leaveType) {
      errors.push({ line: row.line, field: "leave_type", message: `unknown leave type: ${row.leaveType}` });
      continue;
    }

    const remaining = remainingFromOpening({
      grantedHours: row.grantedHours,
      usedHours: row.usedHours,
      remainingHours: row.remainingHours,
    });
    if (!remaining.ok) {
      errors.push({ line: row.line, field: "remaining_hours", message: remaining.error });
      continue;
    }

    const periodYear = periodYearFromAsOf(row.asOf, "UTC");
    const key = importOpeningKey(employee.id, leaveType.id, periodYear);
    if (seen.has(key)) {
      errors.push({
        line: row.line,
        message: `duplicate opening remaining for ${row.email} / ${row.leaveType} / ${periodYear}`,
      });
      continue;
    }
    seen.add(key);

    if (hasImportOpening(world.ledger, employee.id, leaveType.id, periodYear)) {
      errors.push({
        line: row.line,
        code: "DUPLICATE_IMPORT",
        message: "live import: opening remaining already exists for this employee/type/year",
      });
      continue;
    }

    const liveGrant = hasLiveGrantLump(world.ledger, employee.id, leaveType.id, periodYear);
    const plannedGrant = plannedFirstYearFor(world, employee.id, leaveType.id, periodYear);
    if (liveGrant || (plannedGrant && !options.skipFirstYearOnImport)) {
      errors.push({
        line: row.line,
        code: "DOUBLE_GRANT",
        message: "double-grant vs first-year open: opening remaining would stack on Sick grant_lump",
      });
      continue;
    }

    const appRemaining = appRemainingMinutes(world, employee.id, leaveType.id, row.asOf);
    const adjustmentMinutes = remaining.minutes - appRemaining;
    diffs.push({
      line: row.line,
      email: employee.email,
      leaveType: leaveType.code,
      asOf: row.asOf,
      sheetRemainingMinutes: remaining.minutes,
      appRemainingMinutes: appRemaining,
      deltaMinutes: adjustmentMinutes,
    });

    const reason = row.notes
      ? `${IMPORT_OPENING_REASON}: ${row.notes}`
      : IMPORT_OPENING_REASON;
    posts.push({
      line: row.line,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      kind: "adjustment",
      minutes: adjustmentMinutes,
      effectiveOn: row.asOf,
      periodYear,
      reason,
    });
  }

  errors.push(...assertOpeningPostsAreAdjustments(posts));
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, code: "EMPTY", message: "no data rows to import" });
  }
  if (errors.length > 0) {
    return failResult("opening", headers, errors, warnings, { posts, diffs });
  }
  return {
    ok: true,
    kind: "opening",
    headers,
    errors: [],
    warnings,
    errorCsv: importErrorsToCsv([]),
    posts,
    entries: [],
    diffs,
  };
}

const HISTORICAL_STATUSES = new Set<LeaveStatus>(["approved", "rejected", "cancelled"]);

function historicalStatus(raw: string | null): LeaveStatus | { error: string } {
  if (!raw) return "approved";
  const status = raw.trim().toLowerCase() as LeaveStatus;
  if (!HISTORICAL_STATUSES.has(status)) {
    return { error: `unknown status: ${raw.trim()} (use approved, rejected, or cancelled)` };
  }
  return status;
}

function occupancyAsExisting(world: ImportWorld, employeeId: string): ExistingLeave[] {
  const days = (world.occupancy ?? []).filter(
    (row) =>
      row.employeeId === employeeId &&
      row.slotActive &&
      row.consumesBalance &&
      row.status !== "rejected" &&
      row.status !== "cancelled",
  );
  return days.map((day, index) => ({
    id: `occ-${employeeId}-${index}`,
    startDate: day.onDate,
    endDate: day.onDate,
    portion: day.portion,
    consumesBalance: true,
    status: day.status ?? "approved",
    slotActive: true,
    days: [{ onDate: day.onDate, portion: day.portion, consumesBalance: true, slotActive: true }],
  }));
}

function dryRunEntries(
  headers: string[],
  rows: MappedEntryRow[],
  errors: ImportCsvError[],
  warnings: ImportCsvError[],
  world: ImportWorld,
): DryRunResult {
  const posts: PlannedLedgerPost[] = [];
  const entries: PlannedHistoricalEntry[] = [];
  const plannedOccupancy: ImportOccupancy[] = [];

  for (const row of rows) {
    const employee = findEmployee(world, row.email);
    const leaveType = findLeaveType(world, row.leaveType);
    if (!employee) {
      errors.push({ line: row.line, field: "email", message: `unknown email: ${row.email}` });
      continue;
    }
    if (!leaveType) {
      errors.push({ line: row.line, field: "leave_type", message: `unknown leave type: ${row.leaveType}` });
      continue;
    }

    const status = historicalStatus(row.status);
    if (typeof status === "object") {
      errors.push({ line: row.line, field: "status", message: status.error });
      continue;
    }

    const workdayMinutes = employee.workdayMinutes ?? employee.orgWorkdayMinutes;
    const customMinutes =
      row.portion === "custom" && row.hours != null ? hoursToMinutes(row.hours) : null;
    let days = expandToLeaveDays({
      startDate: row.startDate,
      endDate: row.endDate,
      portion: row.portion,
      customMinutes,
      consumesBalance: leaveType.consumesBalance,
      holidays: world.holidays,
      weekendDays: employee.weekendDays,
      workdayMinutes,
    });

    if (row.hours != null && row.portion !== "custom") {
      const total = hoursToMinutes(row.hours);
      const allocated = allocateMinutesAcrossDays(
        days.map((day) => day.onDate),
        total,
      );
      days = days.map((day, index) => ({
        ...day,
        minutes: allocated[index]?.minutes ?? 0,
      }));
    }

    if (days.length === 0) {
      errors.push({ line: row.line, message: "no working days in range" });
      continue;
    }

    const active = status === "approved";
    if (active && leaveType.consumesBalance) {
      const existing = [
        ...occupancyAsExisting(world, employee.id),
        ...plannedOccupancy
          .filter((day) => day.employeeId === employee.id)
          .map((day, index) => ({
            id: `plan-${employee.id}-${index}`,
            startDate: day.onDate,
            endDate: day.onDate,
            portion: day.portion,
            consumesBalance: true,
            status: "approved",
            slotActive: true,
            days: [{ onDate: day.onDate, portion: day.portion, consumesBalance: true, slotActive: true }],
          })),
      ];
      const hit = overlap({
        days,
        consumesBalance: true,
        existing,
        holidays: world.holidays,
        weekendDays: employee.weekendDays,
        workdayMinutes,
      });
      if (hit) {
        errors.push({ line: row.line, code: "OVERLAP", message: hit.message });
        continue;
      }
    }

    const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
    entries.push({
      line: row.line,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: row.startDate,
      endDate: row.endDate,
      portion: row.portion,
      customMinutes,
      totalMinutes,
      note: row.note,
      status,
      intent: "log",
      days: days.map((day) => ({
        onDate: day.onDate,
        minutes: day.minutes,
        portion: day.portion,
        consumesBalance: leaveType.consumesBalance,
      })),
    });

    if (active && leaveType.consumesBalance) {
      for (const day of days) {
        plannedOccupancy.push({
          employeeId: employee.id,
          onDate: day.onDate,
          portion: day.portion,
          consumesBalance: true,
          slotActive: true,
          status: "approved",
        });
      }
      const years = new Set(days.map((day) => periodYearFromAsOf(day.onDate, "UTC")));
      const skipUsageYears = [...years].filter((year) =>
        hasImportOpening(world.ledger, employee.id, leaveType.id, year),
      );
      if (skipUsageYears.length > 0) {
        warnings.push({
          line: row.line,
          code: "OPENING_PLUS_USAGE",
          message:
            "skipping usage: import opening remaining already exists for this employee/type/year (do not import opening and used days for the same year)",
        });
      } else {
        for (const day of days) {
          posts.push({
            line: row.line,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            kind: "usage",
            minutes: day.minutes,
            effectiveOn: day.onDate,
            periodYear: periodYearFromAsOf(day.onDate, "UTC"),
            reason: row.note ? `import: historical entry: ${row.note}` : "import: historical entry",
          });
        }
      }
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, code: "EMPTY", message: "no data rows to import" });
  }
  if (errors.length > 0) {
    return failResult("entries", headers, errors, warnings, { posts, entries });
  }
  return {
    ok: true,
    kind: "entries",
    headers,
    errors: [],
    warnings,
    errorCsv: importErrorsToCsv([]),
    posts,
    entries,
    diffs: [],
  };
}
