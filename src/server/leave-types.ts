import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  policies,
  policyAssignments,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "./audit";
import { getDb } from "./db";
import { isForeignKeyViolation, isUniqueViolation } from "./pg-error";

export const leaveTypeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .transform((code) => code.toLowerCase()),
  name: z.string().trim().min(1),
  consumesBalance: z.boolean(),
  legalUnit: z.enum(["hours", "days"]),
  minIncrementMinutes: z.number().int().positive().nullable(),
  color: z.string().trim().min(1).nullable(),
  unlimited: z.boolean().default(false),
  visibleOnTeamCalendar: z.boolean().default(true),
});

export type LeaveTypeInput = z.infer<typeof leaveTypeInputSchema>;

export type LeaveTypeRecord = Omit<LeaveTypeInput, "legalUnit"> & {
  id: string;
  orgId: string;
  legalUnit: string;
  inUse?: boolean;
};

export type LeaveTypeUsage = {
  leaveEntries: number;
  policies: number;
  ledgerEntries: number;
  policyAssignments: number;
};

export type LeaveTypeWriteOptions = {
  actorId?: string | null;
  writeAudit?: AuditWriter;
  store?: LeaveTypeStore;
};

export type LeaveTypeStore = {
  getById: (orgId: string, id: string) => Promise<LeaveTypeRecord | null>;
  findIdByCode: (orgId: string, code: string, excludeId?: string) => Promise<string | null>;
  insert: (orgId: string, input: LeaveTypeInput) => Promise<LeaveTypeRecord>;
  update: (orgId: string, id: string, input: LeaveTypeInput) => Promise<LeaveTypeRecord | null>;
  remove: (orgId: string, id: string) => Promise<boolean>;
  countUsage: (id: string) => Promise<LeaveTypeUsage>;
};

export function leaveTypeDeleteBlocked(usage: LeaveTypeUsage): boolean {
  return (
    usage.leaveEntries > 0 ||
    usage.policies > 0 ||
    usage.ledgerEntries > 0 ||
    usage.policyAssignments > 0
  );
}

export function parseLeaveTypeInput(raw: unknown):
  | { ok: true; value: LeaveTypeInput }
  | { ok: false; error: string } {
  const parsed = leaveTypeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid leave type" };
  }
  return { ok: true, value: parsed.data };
}

function formBool(form: FormData, name: string, fallback: boolean): boolean {
  const raw = form.get(name);
  if (raw == null || raw === "") return fallback;
  return raw === "true" || raw === "on" || raw === "1";
}

export function leaveTypeFromForm(form: FormData): unknown {
  const minRaw = String(form.get("minIncrementMinutes") ?? "").trim();
  const colorRaw = String(form.get("color") ?? "").trim();
  return {
    code: String(form.get("code") ?? ""),
    name: String(form.get("name") ?? ""),
    consumesBalance: formBool(form, "consumesBalance", true),
    legalUnit: String(form.get("legalUnit") ?? ""),
    minIncrementMinutes: minRaw.length === 0 ? null : Number(minRaw),
    color: colorRaw.length === 0 ? null : colorRaw,
    unlimited: formBool(form, "unlimited", false),
    visibleOnTeamCalendar: formBool(form, "visibleOnTeamCalendar", true),
  };
}

const leaveTypeReturning = {
  id: leaveTypes.id,
  orgId: leaveTypes.orgId,
  code: leaveTypes.code,
  name: leaveTypes.name,
  consumesBalance: leaveTypes.consumesBalance,
  legalUnit: leaveTypes.legalUnit,
  minIncrementMinutes: leaveTypes.minIncrementMinutes,
  color: leaveTypes.color,
  unlimited: leaveTypes.unlimited,
  visibleOnTeamCalendar: leaveTypes.visibleOnTeamCalendar,
};

export async function listLeaveTypes(orgId: string): Promise<LeaveTypeRecord[]> {
  const rows = await getDb()
    .select(leaveTypeReturning)
    .from(leaveTypes)
    .where(eq(leaveTypes.orgId, orgId))
    .orderBy(leaveTypes.code);
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      inUse: leaveTypeDeleteBlocked(await countLeaveTypeUsage(row.id)),
    })),
  );
}

export async function countLeaveTypeUsage(leaveTypeId: string): Promise<LeaveTypeUsage> {
  const db = getDb();
  const [entries, policyRows, ledgerRows, assignmentRows] = await Promise.all([
    db
      .select({ id: leaveEntries.id })
      .from(leaveEntries)
      .where(eq(leaveEntries.leaveTypeId, leaveTypeId))
      .limit(1),
    db
      .select({ id: policies.id })
      .from(policies)
      .where(eq(policies.leaveTypeId, leaveTypeId))
      .limit(1),
    db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.leaveTypeId, leaveTypeId))
      .limit(1),
    db
      .select({ id: policyAssignments.id })
      .from(policyAssignments)
      .where(eq(policyAssignments.leaveTypeId, leaveTypeId))
      .limit(1),
  ]);

  return {
    leaveEntries: entries.length,
    policies: policyRows.length,
    ledgerEntries: ledgerRows.length,
    policyAssignments: assignmentRows.length,
  };
}

export const dbLeaveTypeStore: LeaveTypeStore = {
  async getById(orgId, id) {
    const [row] = await getDb()
      .select(leaveTypeReturning)
      .from(leaveTypes)
      .where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)))
      .limit(1);
    return row ?? null;
  },
  async findIdByCode(orgId, code, excludeId) {
    const [row] = await getDb()
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.orgId, orgId),
          sql`lower(${leaveTypes.code}) = ${code}`,
          excludeId ? ne(leaveTypes.id, excludeId) : undefined,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  },
  async insert(orgId, input) {
    const [created] = await getDb()
      .insert(leaveTypes)
      .values({
        orgId,
        code: input.code,
        name: input.name,
        consumesBalance: input.consumesBalance,
        legalUnit: input.legalUnit,
        minIncrementMinutes: input.minIncrementMinutes,
        color: input.color,
        unlimited: input.unlimited,
        visibleOnTeamCalendar: input.visibleOnTeamCalendar,
      })
      .returning(leaveTypeReturning);
    return created;
  },
  async update(orgId, id, input) {
    const [updated] = await getDb()
      .update(leaveTypes)
      .set({
        code: input.code,
        name: input.name,
        consumesBalance: input.consumesBalance,
        legalUnit: input.legalUnit,
        minIncrementMinutes: input.minIncrementMinutes,
        color: input.color,
        unlimited: input.unlimited,
        visibleOnTeamCalendar: input.visibleOnTeamCalendar,
      })
      .where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)))
      .returning(leaveTypeReturning);
    return updated ?? null;
  },
  async remove(orgId, id) {
    const deleted = await getDb()
      .delete(leaveTypes)
      .where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)))
      .returning({ id: leaveTypes.id });
    return deleted.length > 0;
  },
  countUsage: countLeaveTypeUsage,
};

function storeOf(options: LeaveTypeWriteOptions): LeaveTypeStore {
  return options.store ?? dbLeaveTypeStore;
}

async function audit(
  options: LeaveTypeWriteOptions,
  input: Parameters<AuditWriter>[0],
): Promise<void> {
  await tryWriteAudit(options.writeAudit ?? writeAuditEvent, input);
}

export async function createLeaveType(
  orgId: string,
  input: LeaveTypeInput,
  options: LeaveTypeWriteOptions = {},
): Promise<{ ok: true; leaveType: LeaveTypeRecord } | { ok: false; error: string; status: 409 }> {
  const store = storeOf(options);
  const clash = await store.findIdByCode(orgId, input.code);
  if (clash) {
    return { ok: false, status: 409, error: "leave type code already exists" };
  }

  try {
    const created = await store.insert(orgId, input);
    await audit(options, {
      actorId: options.actorId ?? null,
      action: "leave_type.create",
      entityType: "leave_type",
      entityId: created.id,
      after: created,
    });
    return { ok: true, leaveType: created };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, error: "leave type code already exists" };
    }
    throw err;
  }
}

export async function updateLeaveType(
  orgId: string,
  id: string,
  input: LeaveTypeInput,
  options: LeaveTypeWriteOptions = {},
): Promise<
  { ok: true; leaveType: LeaveTypeRecord } | { ok: false; error: string; status: 404 | 409 }
> {
  const store = storeOf(options);
  const existing = await store.getById(orgId, id);
  if (!existing) {
    return { ok: false, status: 404, error: "leave type not found" };
  }

  const usage = await store.countUsage(id);
  if (
    leaveTypeDeleteBlocked(usage) &&
    (existing.consumesBalance !== input.consumesBalance || existing.legalUnit !== input.legalUnit)
  ) {
    return {
      ok: false,
      status: 409,
      error: "cannot change consumes_balance or legal_unit while the type is in use",
    };
  }

  const clash = await store.findIdByCode(orgId, input.code, id);
  if (clash) {
    return { ok: false, status: 409, error: "leave type code already exists" };
  }

  try {
    const updated = await store.update(orgId, id, input);
    if (!updated) {
      return { ok: false, status: 404, error: "leave type not found" };
    }
    await audit(options, {
      actorId: options.actorId ?? null,
      action: "leave_type.update",
      entityType: "leave_type",
      entityId: id,
      before: existing,
      after: updated,
    });
    return { ok: true, leaveType: updated };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, error: "leave type code already exists" };
    }
    throw err;
  }
}

export async function deleteLeaveType(
  orgId: string,
  id: string,
  options: LeaveTypeWriteOptions = {},
): Promise<{ ok: true } | { ok: false; error: string; status: 404 | 409 }> {
  const store = storeOf(options);
  const existing = await store.getById(orgId, id);
  if (!existing) {
    return { ok: false, status: 404, error: "leave type not found" };
  }

  const usage = await store.countUsage(id);
  if (leaveTypeDeleteBlocked(usage)) {
    return {
      ok: false,
      status: 409,
      error: "cannot delete leave type that has entries or related records",
    };
  }

  try {
    const removed = await store.remove(orgId, id);
    if (!removed) {
      return { ok: false, status: 404, error: "leave type not found" };
    }
  } catch (err) {
    if (isForeignKeyViolation(err) || isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        error: "cannot delete leave type that has entries or related records",
      };
    }
    throw err;
  }

  await audit(options, {
    actorId: options.actorId ?? null,
    action: "leave_type.delete",
    entityType: "leave_type",
    entityId: id,
    before: existing,
  });
  return { ok: true };
}
