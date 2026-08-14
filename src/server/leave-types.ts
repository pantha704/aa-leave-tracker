import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  policies,
  policyAssignments,
} from "@/db/schema";
import { getDb } from "./db";

export const leaveTypeInputSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  consumesBalance: z.boolean(),
  legalUnit: z.enum(["hours", "days"]),
  minIncrementMinutes: z.number().int().positive().nullable(),
  color: z.string().trim().min(1).nullable(),
});

export type LeaveTypeInput = z.infer<typeof leaveTypeInputSchema>;

export type LeaveTypeRecord = Omit<LeaveTypeInput, "legalUnit"> & {
  id: string;
  orgId: string;
  legalUnit: string;
};

export type LeaveTypeUsage = {
  leaveEntries: number;
  policies: number;
  ledgerEntries: number;
  policyAssignments: number;
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

export function leaveTypeFromForm(form: FormData): unknown {
  const minRaw = String(form.get("minIncrementMinutes") ?? "").trim();
  const colorRaw = String(form.get("color") ?? "").trim();
  const consumes = form.get("consumesBalance");
  return {
    code: String(form.get("code") ?? ""),
    name: String(form.get("name") ?? ""),
    consumesBalance: consumes === "true" || consumes === "on" || consumes === "1",
    legalUnit: String(form.get("legalUnit") ?? ""),
    minIncrementMinutes: minRaw.length === 0 ? null : Number(minRaw),
    color: colorRaw.length === 0 ? null : colorRaw,
  };
}

export async function listLeaveTypes(orgId: string): Promise<LeaveTypeRecord[]> {
  return getDb()
    .select({
      id: leaveTypes.id,
      orgId: leaveTypes.orgId,
      code: leaveTypes.code,
      name: leaveTypes.name,
      consumesBalance: leaveTypes.consumesBalance,
      legalUnit: leaveTypes.legalUnit,
      minIncrementMinutes: leaveTypes.minIncrementMinutes,
      color: leaveTypes.color,
    })
    .from(leaveTypes)
    .where(eq(leaveTypes.orgId, orgId))
    .orderBy(leaveTypes.code);
}

export async function createLeaveType(
  orgId: string,
  input: LeaveTypeInput,
): Promise<{ ok: true; leaveType: LeaveTypeRecord } | { ok: false; error: string; status: 409 }> {
  const existing = await getDb()
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.code, input.code)))
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, status: 409, error: "leave type code already exists" };
  }

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
    })
    .returning({
      id: leaveTypes.id,
      orgId: leaveTypes.orgId,
      code: leaveTypes.code,
      name: leaveTypes.name,
      consumesBalance: leaveTypes.consumesBalance,
      legalUnit: leaveTypes.legalUnit,
      minIncrementMinutes: leaveTypes.minIncrementMinutes,
      color: leaveTypes.color,
    });

  return { ok: true, leaveType: created };
}

export async function updateLeaveType(
  orgId: string,
  id: string,
  input: LeaveTypeInput,
): Promise<
  | { ok: true; leaveType: LeaveTypeRecord }
  | { ok: false; error: string; status: 404 | 409 }
> {
  const clash = await getDb()
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.code, input.code), ne(leaveTypes.id, id)))
    .limit(1);
  if (clash.length > 0) {
    return { ok: false, status: 409, error: "leave type code already exists" };
  }

  const updated = await getDb()
    .update(leaveTypes)
    .set({
      code: input.code,
      name: input.name,
      consumesBalance: input.consumesBalance,
      legalUnit: input.legalUnit,
      minIncrementMinutes: input.minIncrementMinutes,
      color: input.color,
    })
    .where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)))
    .returning({
      id: leaveTypes.id,
      orgId: leaveTypes.orgId,
      code: leaveTypes.code,
      name: leaveTypes.name,
      consumesBalance: leaveTypes.consumesBalance,
      legalUnit: leaveTypes.legalUnit,
      minIncrementMinutes: leaveTypes.minIncrementMinutes,
      color: leaveTypes.color,
    });

  if (updated.length === 0) {
    return { ok: false, status: 404, error: "leave type not found" };
  }
  return { ok: true, leaveType: updated[0] };
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

export async function deleteLeaveType(
  orgId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status: 404 | 409 }> {
  const [existing] = await getDb()
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)))
    .limit(1);
  if (!existing) {
    return { ok: false, status: 404, error: "leave type not found" };
  }

  const usage = await countLeaveTypeUsage(id);
  if (leaveTypeDeleteBlocked(usage)) {
    return {
      ok: false,
      status: 409,
      error: "cannot delete leave type that has entries or related records",
    };
  }

  await getDb().delete(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId)));
  return { ok: true };
}
