import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, ne } from "drizzle-orm";
import { DEMO_VACATION_TYPE_CODE } from "@/db/demo-policy";
import {
  employees,
  leaveTypes,
  ledgerEntries,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
} from "@/db/schema";
import { getDatabaseUrl, getDb } from "@/server/db";
import { asOfDateString, isGrantedKind, isLiveLedgerRow } from "@/server/ledger/balance";
import { postLedgerEntry, type LedgerSession, type PostLedgerInput } from "@/server/ledger/post";
import { assignmentCovers, isPeriodOpen } from "@/server/year-end";

export type AccrualTarget = {
  orgId: string;
  timezone: string;
  employeeId: string;
  leaveTypeId: string;
  periodicMinutes: number;
  grantMinutes: number | null;
  accrualStopMinutes: number | null;
  startDate: string;
  endDate: string | null;
};

export type PlannedAccrual = {
  employeeId: string;
  leaveTypeId: string;
  minutes: number;
  effectiveOn: string;
  reason: string;
};

/** December posts the remainder so 12 months equal grant_minutes. */
export function monthlyAccrualMinutes(input: {
  month: number;
  periodicMinutes: number;
  grantMinutes: number | null;
}): number {
  if (input.month === 12 && input.grantMinutes != null) {
    return input.grantMinutes - 11 * input.periodicMinutes;
  }
  return input.periodicMinutes;
}

export function monthStartInZone(asOf: Date | string, timeZone: string): string {
  const civil = asOfDateString(asOf, timeZone);
  return `${civil.slice(0, 7)}-01`;
}

export function monthNumber(isoDate: string): number {
  return Number(isoDate.slice(5, 7));
}

export function periodYearOfMonthStart(monthStart: string): number {
  return Number(monthStart.slice(0, 4));
}

/**
 * Writer (1): skip unless the civil month has already started for this hire,
 * the period is open, no live accrual exists, and accrual_stop is not hit.
 * Mid-month hires are writer (2), not this job.
 */
export function shouldPostMonthlyAccrual(input: {
  periodStatus: string | null;
  monthStart: string;
  startDate: string;
  endDate: string | null;
  liveAccrualExists: boolean;
  grantedCredits: number;
  accrualStopMinutes: number | null;
  minutes: number;
}): boolean {
  if (!isPeriodOpen(input.periodStatus)) return false;
  if (input.minutes <= 0) return false;
  if (input.liveAccrualExists) return false;
  if (input.startDate > input.monthStart) return false;
  if (input.endDate != null && input.endDate < input.monthStart) return false;
  if (input.accrualStopMinutes != null && input.grantedCredits >= input.accrualStopMinutes) {
    return false;
  }
  return true;
}

export function planMonthlyAccrual(input: {
  periodStatus: string | null;
  monthStart: string;
  target: AccrualTarget;
  liveAccrualExists: boolean;
  grantedCredits: number;
}): PlannedAccrual | null {
  const minutes = monthlyAccrualMinutes({
    month: monthNumber(input.monthStart),
    periodicMinutes: input.target.periodicMinutes,
    grantMinutes: input.target.grantMinutes,
  });
  if (
    !shouldPostMonthlyAccrual({
      periodStatus: input.periodStatus,
      monthStart: input.monthStart,
      startDate: input.target.startDate,
      endDate: input.target.endDate,
      liveAccrualExists: input.liveAccrualExists,
      grantedCredits: input.grantedCredits,
      accrualStopMinutes: input.target.accrualStopMinutes,
      minutes,
    })
  ) {
    return null;
  }
  return {
    employeeId: input.target.employeeId,
    leaveTypeId: input.target.leaveTypeId,
    minutes,
    effectiveOn: input.monthStart,
    reason: `accrual:${input.monthStart}`,
  };
}

export type AccrualJobResult = {
  asOf: string;
  orgs: number;
  considered: number;
  posted: number;
  skippedNotOpen: number;
};

async function loadPeriodStatus(
  db: LedgerSession,
  orgId: string,
  year: number,
): Promise<string | null> {
  const [row] = await db
    .select({ status: policyPeriods.status })
    .from(policyPeriods)
    .where(and(eq(policyPeriods.orgId, orgId), eq(policyPeriods.year, year)))
    .limit(1);
  return row?.status ?? null;
}

async function grantedCreditsInPeriod(
  db: LedgerSession,
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
): Promise<number> {
  const rows = await db
    .select({
      kind: ledgerEntries.kind,
      minutes: ledgerEntries.minutes,
      reversedAt: ledgerEntries.reversedAt,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.employeeId, employeeId),
        eq(ledgerEntries.leaveTypeId, leaveTypeId),
        eq(ledgerEntries.periodYear, periodYear),
        isNull(ledgerEntries.reversedAt),
        ne(ledgerEntries.kind, "reversal"),
      ),
    );
  return rows
    .filter((row) => isLiveLedgerRow(row) && isGrantedKind(row.kind))
    .reduce((sum, row) => sum + row.minutes, 0);
}

async function liveAccrualExists(
  db: LedgerSession,
  employeeId: string,
  leaveTypeId: string,
  periodYear: number,
  effectiveOn: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.employeeId, employeeId),
        eq(ledgerEntries.leaveTypeId, leaveTypeId),
        eq(ledgerEntries.kind, "accrual"),
        eq(ledgerEntries.periodYear, periodYear),
        eq(ledgerEntries.effectiveOn, effectiveOn),
        isNull(ledgerEntries.reversedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type AccrualAssignmentTarget = {
  employeeId: string;
  leaveTypeId: string;
  periodicMinutes: number | null;
  grantMinutes: number | null;
  accrualStopMinutes: number | null;
  startDate: string;
  endDate: string | null;
  validFrom: string;
  validTo: string | null;
};

export type AccrualJobSource = {
  listOrgs: () => Promise<Array<{ id: string; timezone: string; accrualJobEnabled: boolean }>>;
  periodStatus: (orgId: string, year: number) => Promise<string | null>;
  listTargets: (orgId: string) => Promise<AccrualAssignmentTarget[]>;
  liveAccrualExists: (
    employeeId: string,
    leaveTypeId: string,
    periodYear: number,
    effectiveOn: string,
  ) => Promise<boolean>;
  grantedCredits: (employeeId: string, leaveTypeId: string, periodYear: number) => Promise<number>;
  adminId: (orgId: string) => Promise<string | undefined>;
  post: (input: PostLedgerInput) => Promise<void>;
};

export function pgAccrualSource(db: LedgerSession, createdByOverride?: string): AccrualJobSource {
  return {
    async listOrgs() {
      return db
        .select({
          id: organizations.id,
          timezone: organizations.timezone,
          accrualJobEnabled: orgSettings.accrualJobEnabled,
        })
        .from(organizations)
        .innerJoin(orgSettings, eq(orgSettings.orgId, organizations.id));
    },
    periodStatus: (orgId, year) => loadPeriodStatus(db, orgId, year),
    async listTargets(orgId) {
      return db
        .select({
          employeeId: employees.id,
          leaveTypeId: leaveTypes.id,
          periodicMinutes: policies.periodicMinutes,
          grantMinutes: policies.grantMinutes,
          accrualStopMinutes: policies.accrualStopMinutes,
          startDate: employees.startDate,
          endDate: employees.endDate,
          validFrom: policyAssignments.validFrom,
          validTo: policyAssignments.validTo,
        })
        .from(policyAssignments)
        .innerJoin(employees, eq(employees.id, policyAssignments.employeeId))
        .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, policyAssignments.leaveTypeId))
        .where(
          and(
            eq(employees.orgId, orgId),
            eq(employees.active, true),
            eq(leaveTypes.code, DEMO_VACATION_TYPE_CODE),
            eq(policies.grantMode, "periodic"),
            eq(policies.periodicCadence, "monthly"),
          ),
        );
    },
    liveAccrualExists: (employeeId, leaveTypeId, periodYear, effectiveOn) =>
      liveAccrualExists(db, employeeId, leaveTypeId, periodYear, effectiveOn),
    grantedCredits: (employeeId, leaveTypeId, periodYear) =>
      grantedCreditsInPeriod(db, employeeId, leaveTypeId, periodYear),
    async adminId(orgId) {
      if (createdByOverride) return createdByOverride;
      const [row] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.orgId, orgId), eq(employees.role, "admin")))
        .limit(1);
      return row?.id;
    },
    async post(input) {
      await postLedgerEntry(db, input);
    },
  };
}

export async function runMonthlyAccrual(
  asOf: Date | string = new Date(),
  source: AccrualJobSource = pgAccrualSource(getDb()),
): Promise<AccrualJobResult> {
  const orgs = await source.listOrgs();

  let considered = 0;
  let posted = 0;
  let skippedNotOpen = 0;
  let asOfLabel = typeof asOf === "string" ? asOf : asOf.toISOString();

  for (const org of orgs) {
    if (!org.accrualJobEnabled) continue;
    const monthStart = monthStartInZone(asOf, org.timezone);
    asOfLabel = monthStart;
    const year = periodYearOfMonthStart(monthStart);
    const periodStatus = await source.periodStatus(org.id, year);
    if (!isPeriodOpen(periodStatus)) {
      skippedNotOpen += 1;
      continue;
    }

    const targets = await source.listTargets(org.id);
    const actorId = await source.adminId(org.id);
    if (!actorId) continue;

    for (const target of targets) {
      if (target.periodicMinutes == null) continue;
      if (!assignmentCovers(target, monthStart)) continue;
      considered += 1;
      const exists = await source.liveAccrualExists(target.employeeId, target.leaveTypeId, year, monthStart);
      const credits = await source.grantedCredits(target.employeeId, target.leaveTypeId, year);
      const planned = planMonthlyAccrual({
        periodStatus,
        monthStart,
        liveAccrualExists: exists,
        grantedCredits: credits,
        target: {
          orgId: org.id,
          timezone: org.timezone,
          employeeId: target.employeeId,
          leaveTypeId: target.leaveTypeId,
          periodicMinutes: target.periodicMinutes,
          grantMinutes: target.grantMinutes,
          accrualStopMinutes: target.accrualStopMinutes,
          startDate: target.startDate,
          endDate: target.endDate,
        },
      });
      if (!planned) continue;
      const input: PostLedgerInput = {
        employeeId: planned.employeeId,
        leaveTypeId: planned.leaveTypeId,
        kind: "accrual",
        minutes: planned.minutes,
        effectiveOn: planned.effectiveOn,
        reason: planned.reason,
        createdBy: actorId,
      };
      try {
        await source.post(input);
        posted += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/live grant already exists|duplicate key|unique/i.test(message)) {
          continue;
        }
        throw err;
      }
    }
  }

  return { asOf: asOfLabel, orgs: orgs.length, considered, posted, skippedNotOpen };
}

function isExecutedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

if (isExecutedAsScript()) {
  if (!getDatabaseUrl()) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMonthlyAccrual()
    .then((result) => {
      console.log(
        `accrual asOf=${result.asOf} posted=${result.posted} considered=${result.considered} skippedNotOpen=${result.skippedNotOpen}`,
      );
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
