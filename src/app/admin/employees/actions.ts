"use server";

import { revalidatePath } from "next/cache";
import { assignEmployeePolicy, findLeaveEntryInOrg, postAdjustment } from "@/server/admin/employees";
import { requireAdmin } from "@/server/auth";
import { authzActorFromEmployee } from "@/server/authz";
import { decideLeave, type DecideAction } from "@/server/leave/decide";
import { terminateEmployee } from "@/server/terminate";

export type AdminFormState =
  | { ok: true; downloadPath?: string }
  | { ok: false; error: string }
  | undefined;

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
    actor: authzActorFromEmployee(employee),
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
    actor: authzActorFromEmployee(employee),
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

  const scoped = await findLeaveEntryInOrg(employee.orgId, entryId);
  if (!scoped) return { ok: false, error: "leave entry not found" };

  const result = await decideLeave({
    actor: authzActorFromEmployee(employee),
    entryId,
    action,
    adminNote: String(formData.get("adminNote") ?? "").trim() || undefined,
    override: formData.get("override") === "on",
  });
  if (!result.ok) return { ok: false, error: result.message };
  refresh(employeeId);
  return { ok: true };
}

export async function terminateEmployeeAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { employee } = await requireAdmin();
  const employeeId = String(formData.get("employeeId") ?? "");
  const result = await terminateEmployee({
    actor: authzActorFromEmployee(employee),
    orgId: employee.orgId,
    employeeId,
    raw: {
      endDate: String(formData.get("endDate") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    },
  });
  if (!result.ok) return { ok: false, error: result.error };
  refresh(employeeId);
  return { ok: true, downloadPath: result.downloadPath };
}
