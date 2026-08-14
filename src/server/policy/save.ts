import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  employees,
  leaveTypes,
  policies,
  policyAssignments,
  policyTenureBands,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getDb } from "@/server/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Rejects 2026-02-31 / 2026-13-40 so Postgres date columns never see them. */
export function parseCalendarDate(value: string): string | null {
  const match = value.trim().match(ISO_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

const uuid = z.string().regex(UUID_RE, "must be a uuid");
const isoDate = z.string().refine((value) => parseCalendarDate(value) !== null, {
  message: "must be a real calendar date (YYYY-MM-DD)",
});
const intMinutes = z.number().int("must be an integer number of minutes").nonnegative();
const nullableMinutes = intMinutes.nullable();

export const GRANT_MODES = ["lump_sum", "periodic", "hourly_worked", "none"] as const;
export const PERIODS = ["calendar_year", "anniversary"] as const;
export const PERIODIC_CADENCES = ["monthly", "biweekly", "weekly"] as const;
export const APPROVAL_MODES = ["none", "manager", "admin"] as const;

export const tenureBandSchema = z
  .object({
    min_years: z.number().int().nonnegative(),
    max_years: z.number().int().nonnegative().nullable().optional(),
    grant_minutes: intMinutes,
  })
  .refine((band) => band.max_years == null || band.max_years >= band.min_years, {
    message: "max_years must be >= min_years",
    path: ["max_years"],
  });

export const policySaveSchema = z.object({
  leave_type_id: uuid,
  name: z.string().trim().min(1),
  period: z.enum(PERIODS).default("calendar_year"),
  grant_mode: z.enum(GRANT_MODES),
  grant_minutes: nullableMinutes.optional(),
  periodic_cadence: z.enum(PERIODIC_CADENCES).nullable().optional(),
  periodic_minutes: nullableMinutes.optional(),
  accrual_stop_minutes: nullableMinutes.optional(),
  take_ceiling_minutes: nullableMinutes.optional(),
  carryover_max_minutes: nullableMinutes.optional(),
  allow_forfeit: z.boolean().default(false),
  negative_allowed: z.boolean().default(false),
  negative_floor_minutes: z.number().int().nullable().optional(),
  waiting_period_days: z.number().int().nonnegative().default(0),
  approval_for_request: z.enum(APPROVAL_MODES).default("admin"),
  approval_for_log: z.enum(APPROVAL_MODES).default("none"),
  notice_days: z.number().int().nonnegative().nullable().optional(),
  min_increment_minutes: z.number().int().positive().default(60),
  effective_from: isoDate,
  effective_to: isoDate.nullable().optional(),
  tenure_bands: z.array(tenureBandSchema).default([]),
});

export type PolicySaveInput = z.infer<typeof policySaveSchema>;

export type TenureBandInput = {
  minYears: number;
  maxYears: number | null;
  grantMinutes: number;
};

export type PolicyRecord = {
  id: string;
  orgId: string;
  leaveTypeId: string;
  name: string;
  period: string;
  grantMode: string;
  grantMinutes: number | null;
  periodicCadence: string | null;
  periodicMinutes: number | null;
  accrualStopMinutes: number | null;
  takeCeilingMinutes: number | null;
  carryoverMaxMinutes: number | null;
  allowForfeit: boolean;
  negativeAllowed: boolean;
  negativeFloorMinutes: number | null;
  waitingPeriodDays: number;
  approvalForRequest: string;
  approvalForLog: string;
  noticeDays: number | null;
  minIncrementMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  tenureBands: TenureBandInput[];
};

export const assignmentSaveSchema = z.object({
  employee_id: uuid,
  policy_id: uuid,
  valid_from: isoDate,
  valid_to: isoDate.nullable().optional(),
});

export type AssignmentSaveInput = z.infer<typeof assignmentSaveSchema>;

export type AssignmentRecord = {
  id: string;
  employeeId: string;
  policyId: string;
  leaveTypeId: string;
  validFrom: string;
  validTo: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeTenureBand(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  return {
    min_years: firstDefined(raw.min_years, raw.minYears),
    max_years: firstDefined(raw.max_years, raw.maxYears),
    grant_minutes: firstDefined(raw.grant_minutes, raw.grantMinutes),
  };
}

/** Accept snake_case JSON plus take_ceiling as an alias of take_ceiling_minutes. */
export function normalizePolicyJson(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;

  const takeCeilingMinutes = firstDefined(
    raw.take_ceiling_minutes,
    raw.takeCeilingMinutes,
    raw.take_ceiling,
  );

  const bands = firstDefined(raw.tenure_bands, raw.tenureBands);
  return {
    leave_type_id: firstDefined(raw.leave_type_id, raw.leaveTypeId),
    name: raw.name,
    period: raw.period,
    grant_mode: firstDefined(raw.grant_mode, raw.grantMode),
    grant_minutes: firstDefined(raw.grant_minutes, raw.grantMinutes),
    periodic_cadence: firstDefined(raw.periodic_cadence, raw.periodicCadence),
    periodic_minutes: firstDefined(raw.periodic_minutes, raw.periodicMinutes),
    accrual_stop_minutes: firstDefined(raw.accrual_stop_minutes, raw.accrualStopMinutes),
    take_ceiling_minutes: takeCeilingMinutes,
    carryover_max_minutes: firstDefined(raw.carryover_max_minutes, raw.carryoverMaxMinutes),
    allow_forfeit: firstDefined(raw.allow_forfeit, raw.allowForfeit),
    negative_allowed: firstDefined(raw.negative_allowed, raw.negativeAllowed),
    negative_floor_minutes: firstDefined(raw.negative_floor_minutes, raw.negativeFloorMinutes),
    waiting_period_days: firstDefined(raw.waiting_period_days, raw.waitingPeriodDays),
    approval_for_request: firstDefined(raw.approval_for_request, raw.approvalForRequest),
    approval_for_log: firstDefined(raw.approval_for_log, raw.approvalForLog),
    notice_days: firstDefined(raw.notice_days, raw.noticeDays),
    min_increment_minutes: firstDefined(raw.min_increment_minutes, raw.minIncrementMinutes),
    effective_from: firstDefined(raw.effective_from, raw.effectiveFrom),
    effective_to: firstDefined(raw.effective_to, raw.effectiveTo),
    tenure_bands: Array.isArray(bands) ? bands.map(normalizeTenureBand) : bands,
  };
}

export function normalizeAssignmentJson(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  return {
    employee_id: firstDefined(raw.employee_id, raw.employeeId),
    policy_id: firstDefined(raw.policy_id, raw.policyId),
    valid_from: firstDefined(raw.valid_from, raw.validFrom),
    valid_to: firstDefined(raw.valid_to, raw.validTo),
  };
}

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; error: string };

function zodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parsePolicyInput(raw: unknown): ParseOk<PolicySaveInput> | ParseErr {
  const parsed = policySaveSchema.safeParse(normalizePolicyJson(raw));
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const value = parsed.data;
  if (value.effective_to && value.effective_to < value.effective_from) {
    return { ok: false, error: "effective_to must be on or after effective_from" };
  }
  return { ok: true, value };
}

export function parsePolicyJson(text: string): ParseOk<PolicySaveInput> | ParseErr {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  return parsePolicyInput(raw);
}

export function parseAssignmentInput(raw: unknown): ParseOk<AssignmentSaveInput> | ParseErr {
  const parsed = assignmentSaveSchema.safeParse(normalizeAssignmentJson(raw));
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const value = parsed.data;
  if (value.valid_to && value.valid_to < value.valid_from) {
    return { ok: false, error: "valid_to must be on or after valid_from" };
  }
  return { ok: true, value };
}

const policyReturning = {
  id: policies.id,
  orgId: policies.orgId,
  leaveTypeId: policies.leaveTypeId,
  name: policies.name,
  period: policies.period,
  grantMode: policies.grantMode,
  grantMinutes: policies.grantMinutes,
  periodicCadence: policies.periodicCadence,
  periodicMinutes: policies.periodicMinutes,
  accrualStopMinutes: policies.accrualStopMinutes,
  takeCeilingMinutes: policies.takeCeilingMinutes,
  carryoverMaxMinutes: policies.carryoverMaxMinutes,
  allowForfeit: policies.allowForfeit,
  negativeAllowed: policies.negativeAllowed,
  negativeFloorMinutes: policies.negativeFloorMinutes,
  waitingPeriodDays: policies.waitingPeriodDays,
  approvalForRequest: policies.approvalForRequest,
  approvalForLog: policies.approvalForLog,
  noticeDays: policies.noticeDays,
  minIncrementMinutes: policies.minIncrementMinutes,
  effectiveFrom: policies.effectiveFrom,
  effectiveTo: policies.effectiveTo,
};

function policyValues(orgId: string, input: PolicySaveInput) {
  return {
    orgId,
    leaveTypeId: input.leave_type_id,
    name: input.name,
    period: input.period,
    grantMode: input.grant_mode,
    grantMinutes: input.grant_minutes ?? null,
    periodicCadence: input.periodic_cadence ?? null,
    periodicMinutes: input.periodic_minutes ?? null,
    accrualStopMinutes: input.accrual_stop_minutes ?? null,
    takeCeilingMinutes: input.take_ceiling_minutes ?? null,
    carryoverMaxMinutes: input.carryover_max_minutes ?? null,
    allowForfeit: input.allow_forfeit,
    negativeAllowed: input.negative_allowed,
    negativeFloorMinutes: input.negative_floor_minutes ?? null,
    waitingPeriodDays: input.waiting_period_days,
    approvalForRequest: input.approval_for_request,
    approvalForLog: input.approval_for_log,
    noticeDays: input.notice_days ?? null,
    minIncrementMinutes: input.min_increment_minutes,
    effectiveFrom: input.effective_from,
    effectiveTo: input.effective_to ?? null,
  };
}

function attachBands(
  row: Omit<PolicyRecord, "tenureBands">,
  bands: TenureBandInput[],
): PolicyRecord {
  return { ...row, tenureBands: bands };
}

function bandRows(input: PolicySaveInput): TenureBandInput[] {
  return input.tenure_bands.map((band) => ({
    minYears: band.min_years,
    maxYears: band.max_years ?? null,
    grantMinutes: band.grant_minutes,
  }));
}

type WriteDb = Pick<ReturnType<typeof getDb>, "delete" | "insert">;

async function replaceTenureBands(
  tx: WriteDb,
  policyId: string,
  bands: TenureBandInput[],
): Promise<void> {
  await tx.delete(policyTenureBands).where(eq(policyTenureBands.policyId, policyId));
  if (bands.length === 0) return;
  await tx.insert(policyTenureBands).values(
    bands.map((band) => ({
      policyId,
      minYears: band.minYears,
      maxYears: band.maxYears,
      grantMinutes: band.grantMinutes,
    })),
  );
}

async function loadBands(
  db: ReturnType<typeof getDb>,
  policyIds: string[],
): Promise<Map<string, TenureBandInput[]>> {
  const map = new Map<string, TenureBandInput[]>();
  for (const id of policyIds) map.set(id, []);
  if (policyIds.length === 0) return map;
  const rows = await db
    .select({
      policyId: policyTenureBands.policyId,
      minYears: policyTenureBands.minYears,
      maxYears: policyTenureBands.maxYears,
      grantMinutes: policyTenureBands.grantMinutes,
    })
    .from(policyTenureBands)
    .where(inArray(policyTenureBands.policyId, policyIds));
  for (const row of rows) {
    map.get(row.policyId)?.push({
      minYears: row.minYears,
      maxYears: row.maxYears,
      grantMinutes: row.grantMinutes,
    });
  }
  return map;
}

export function policyToEditorJson(policy: PolicyRecord): string {
  return JSON.stringify(
    {
      leave_type_id: policy.leaveTypeId,
      name: policy.name,
      period: policy.period,
      grant_mode: policy.grantMode,
      grant_minutes: policy.grantMinutes,
      periodic_cadence: policy.periodicCadence,
      periodic_minutes: policy.periodicMinutes,
      accrual_stop_minutes: policy.accrualStopMinutes,
      take_ceiling_minutes: policy.takeCeilingMinutes,
      carryover_max_minutes: policy.carryoverMaxMinutes,
      allow_forfeit: policy.allowForfeit,
      negative_allowed: policy.negativeAllowed,
      negative_floor_minutes: policy.negativeFloorMinutes,
      waiting_period_days: policy.waitingPeriodDays,
      approval_for_request: policy.approvalForRequest,
      approval_for_log: policy.approvalForLog,
      notice_days: policy.noticeDays,
      min_increment_minutes: policy.minIncrementMinutes,
      effective_from: policy.effectiveFrom,
      effective_to: policy.effectiveTo,
      tenure_bands: policy.tenureBands.map((band) => ({
        min_years: band.minYears,
        max_years: band.maxYears,
        grant_minutes: band.grantMinutes,
      })),
    },
    null,
    2,
  );
}

export function newPolicyJson(leaveTypeId = ""): string {
  return JSON.stringify(
    {
      leave_type_id: leaveTypeId,
      name: "",
      period: "calendar_year",
      grant_mode: "periodic",
      grant_minutes: null,
      periodic_cadence: "monthly",
      periodic_minutes: null,
      accrual_stop_minutes: null,
      take_ceiling_minutes: null,
      carryover_max_minutes: null,
      allow_forfeit: false,
      negative_allowed: false,
      negative_floor_minutes: null,
      waiting_period_days: 0,
      approval_for_request: "admin",
      approval_for_log: "none",
      notice_days: null,
      min_increment_minutes: 60,
      effective_from: "2026-01-01",
      effective_to: null,
      tenure_bands: [],
    },
    null,
    2,
  );
}

export const NEW_POLICY_JSON = newPolicyJson();

export async function listPolicies(orgId: string): Promise<PolicyRecord[]> {
  const db = getDb();
  const rows = await db.select(policyReturning).from(policies).where(eq(policies.orgId, orgId));
  const bands = await loadBands(
    db,
    rows.map((row) => row.id),
  );
  return rows
    .map((row) => attachBands(row, bands.get(row.id) ?? []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAssignments(orgId: string): Promise<
  Array<
    AssignmentRecord & {
      employeeName: string;
      employeeEmail: string;
      policyName: string;
    }
  >
> {
  return getDb()
    .select({
      id: policyAssignments.id,
      employeeId: policyAssignments.employeeId,
      policyId: policyAssignments.policyId,
      leaveTypeId: policyAssignments.leaveTypeId,
      validFrom: policyAssignments.validFrom,
      validTo: policyAssignments.validTo,
      employeeName: employees.name,
      employeeEmail: employees.email,
      policyName: policies.name,
    })
    .from(policyAssignments)
    .innerJoin(employees, eq(employees.id, policyAssignments.employeeId))
    .innerJoin(policies, eq(policies.id, policyAssignments.policyId))
    .where(eq(employees.orgId, orgId))
    .orderBy(employees.name, policies.name);
}

export async function listOrgEmployees(orgId: string) {
  return getDb()
    .select({
      id: employees.id,
      name: employees.name,
      email: employees.email,
    })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .orderBy(employees.name);
}

export async function listOrgLeaveTypes(orgId: string) {
  return getDb()
    .select({
      id: leaveTypes.id,
      code: leaveTypes.code,
      name: leaveTypes.name,
    })
    .from(leaveTypes)
    .where(eq(leaveTypes.orgId, orgId))
    .orderBy(leaveTypes.code);
}

export type SavePolicyResult =
  | { ok: true; policy: PolicyRecord }
  | { ok: false; error: string; status: 400 | 404 };

export type AssignPolicyResult =
  | { ok: true; assignment: AssignmentRecord; updatedInPlace: boolean }
  | { ok: false; error: string; status: 400 | 404 };

const assignmentReturning = {
  id: policyAssignments.id,
  employeeId: policyAssignments.employeeId,
  policyId: policyAssignments.policyId,
  leaveTypeId: policyAssignments.leaveTypeId,
  validFrom: policyAssignments.validFrom,
  validTo: policyAssignments.validTo,
};

export type PolicyPersistence = {
  leaveTypeInOrg: (orgId: string, leaveTypeId: string) => Promise<boolean>;
  insertPolicy: (orgId: string, input: PolicySaveInput) => Promise<PolicyRecord>;
  getPolicy: (orgId: string, id: string) => Promise<PolicyRecord | null>;
  updatePolicyRow: (
    orgId: string,
    id: string,
    input: PolicySaveInput,
  ) => Promise<PolicyRecord | null>;
  getPolicyRef: (
    orgId: string,
    policyId: string,
  ) => Promise<{ id: string; leaveTypeId: string } | null>;
  employeeInOrg: (orgId: string, employeeId: string) => Promise<boolean>;
  upsertAssignment: (
    row: Omit<AssignmentRecord, "id">,
  ) => Promise<{ assignment: AssignmentRecord; updatedInPlace: boolean }>;
};

function postgresWriteError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "23503") return "referenced row not found";
  if (code === "23505") return "unique constraint violated";
  if (code === "22007" || code === "22008") return "invalid date";
  if (err instanceof Error && err.message) return err.message;
  return "could not save";
}

export const pgPolicyPersistence: PolicyPersistence = {
  async leaveTypeInOrg(orgId, leaveTypeId) {
    const [row] = await getDb()
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.orgId, orgId)))
      .limit(1);
    return Boolean(row);
  },
  async insertPolicy(orgId, input) {
    const db = getDb();
    const bands = bandRows(input);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(policies)
        .values(policyValues(orgId, input))
        .returning(policyReturning);
      await replaceTenureBands(tx, row.id, bands);
      return attachBands(row, bands);
    });
  },
  async getPolicy(orgId, id) {
    const db = getDb();
    const [row] = await db
      .select(policyReturning)
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
      .limit(1);
    if (!row) return null;
    return attachBands(row, (await loadBands(db, [id])).get(id) ?? []);
  },
  async updatePolicyRow(orgId, id, input) {
    const db = getDb();
    const bands = bandRows(input);
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(policies)
        .set(policyValues(orgId, input))
        .where(and(eq(policies.id, id), eq(policies.orgId, orgId)))
        .returning(policyReturning);
      if (rows.length === 0) return null;
      await replaceTenureBands(tx, id, bands);
      return attachBands(rows[0], bands);
    });
  },
  async getPolicyRef(orgId, policyId) {
    const [row] = await getDb()
      .select({ id: policies.id, leaveTypeId: policies.leaveTypeId })
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .limit(1);
    return row ?? null;
  },
  async employeeInOrg(orgId, employeeId) {
    const [row] = await getDb()
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)))
      .limit(1);
    return Boolean(row);
  },
  async upsertAssignment(row) {
    const proposedId = crypto.randomUUID();
    const [saved] = await getDb()
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
    return { assignment: saved, updatedInPlace: saved.id !== proposedId };
  },
};

export async function createPolicy(
  orgId: string,
  input: PolicySaveInput,
  actorId: string,
  writeAudit: AuditWriter = writeAuditEvent,
  persist: PolicyPersistence = pgPolicyPersistence,
): Promise<SavePolicyResult> {
  try {
    if (!(await persist.leaveTypeInOrg(orgId, input.leave_type_id))) {
      return { ok: false, status: 400, error: "leave_type_id not found in org" };
    }
    const created = await persist.insertPolicy(orgId, input);
    await tryWriteAudit(writeAudit, {
      actorId,
      action: "policy.created",
      entityType: "policy",
      entityId: created.id,
      after: created,
    });
    return { ok: true, policy: created };
  } catch (err) {
    return { ok: false, status: 400, error: postgresWriteError(err) };
  }
}

export async function updatePolicy(
  orgId: string,
  id: string,
  input: PolicySaveInput,
  actorId: string,
  writeAudit: AuditWriter = writeAuditEvent,
  persist: PolicyPersistence = pgPolicyPersistence,
): Promise<SavePolicyResult> {
  try {
    const existing = await persist.getPolicy(orgId, id);
    if (!existing) {
      return { ok: false, status: 404, error: "policy not found" };
    }
    if (existing.leaveTypeId !== input.leave_type_id) {
      return { ok: false, status: 400, error: "cannot change leave_type_id (one type per policy)" };
    }
    const updated = await persist.updatePolicyRow(orgId, id, input);
    if (!updated) {
      return { ok: false, status: 404, error: "policy not found" };
    }
    await tryWriteAudit(writeAudit, {
      actorId,
      action: "policy.updated",
      entityType: "policy",
      entityId: id,
      before: existing,
      after: updated,
    });
    return { ok: true, policy: updated };
  } catch (err) {
    return { ok: false, status: 400, error: postgresWriteError(err) };
  }
}

export async function assignPolicy(
  orgId: string,
  input: AssignmentSaveInput,
  actorId: string,
  writeAudit: AuditWriter = writeAuditEvent,
  persist: PolicyPersistence = pgPolicyPersistence,
): Promise<AssignPolicyResult> {
  try {
    const policy = await persist.getPolicyRef(orgId, input.policy_id);
    if (!policy) {
      return { ok: false, status: 404, error: "policy not found" };
    }
    if (!(await persist.employeeInOrg(orgId, input.employee_id))) {
      return { ok: false, status: 400, error: "employee not found in org" };
    }

    const result = await persist.upsertAssignment({
      employeeId: input.employee_id,
      policyId: input.policy_id,
      leaveTypeId: policy.leaveTypeId,
      validFrom: input.valid_from,
      validTo: input.valid_to ?? null,
    });
    await tryWriteAudit(writeAudit, {
      actorId,
      action: "policy.assigned",
      entityType: "policy_assignment",
      entityId: result.assignment.id,
      after: result.assignment,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, status: 400, error: postgresWriteError(err) };
  }
}
