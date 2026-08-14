"use server";

import { revalidatePath } from "next/cache";
import { assignEmployeePolicy, postAdjustment } from "@/server/admin/employees";
import { requireAdmin } from "@/server/auth";
import { decideLeave, type DecideAction } from "@/server/leave/decide";

export type AdminFormState = { ok: true } | { ok: false; error: string } | undefined;

const ACTIONS = new Set<DecideAction>(["approve", "reject", "cancel"]);

function refresh(employeeId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/employees");
  if (employeeId) revalidatePath(`/admin/employees/${employeeId}`);
}

export async function adjustHoursAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { employee } = await requireAdmin();
  const employeeId = String(formData.get("employeeId") ?? "");
  const result = await postAdjustment({
    actor: { id: employee.id, role: "admin" },
    orgId: employee.orgId,
    employeeId,
    raw: {
      leaveTypeId: String(formData.get("leaveTypeId") ?? ""),
      hours: String(formData.get("hours") ?? ""),
      effectiveOn: String(formData.get("effectiveOn") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    },
  });
  if (!result.ok) return { ok: false, error: result.error };
  refresh(employeeId);
  return { ok: true };
}

export async function assignPolicyAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { employee } = await requireAdmin();
  const employeeId = String(formData.get("employeeId") ?? "");
  const result = await assignEmployeePolicy({
    actor: { id: employee.id, role: "admin" },
    orgId: employee.orgId,
    employeeId,
    raw: {
      policyId: String(formData.get("policyId") ?? ""),
      validFrom: String(formData.get("validFrom") ?? ""),
      validTo: String(formData.get("validTo") ?? ""),
    },
  });
  if (!result.ok) return { ok: false, error: result.error };
  refresh(employeeId);
  return { ok: true };
}

export async function decideEntryAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { employee } = await requireAdmin();
  const entryId = String(formData.get("entryId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  const action = String(formData.get("action") ?? "") as DecideAction;
  if (!ACTIONS.has(action)) return { ok: false, error: "invalid action" };

  const result = await decideLeave({
    actor: { id: employee.id, role: "admin" },
    entryId,
    action,
    adminNote: String(formData.get("adminNote") ?? "").trim() || undefined,
    override: formData.get("override") === "on",
  });
  if (!result.ok) return { ok: false, error: result.message };
  refresh(employeeId);
  return { ok: true };
}
