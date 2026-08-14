"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import {
  createLeaveType,
  deleteLeaveType,
  leaveTypeFromForm,
  parseLeaveTypeInput,
  updateLeaveType,
} from "@/server/leave-types";

export type LeaveTypeFormState = { ok: true } | { ok: false; error: string } | undefined;

function refresh() {
  revalidatePath("/admin/leave-types");
}

export async function createLeaveTypeAction(
  _prev: LeaveTypeFormState,
  formData: FormData,
): Promise<LeaveTypeFormState> {
  const { employee } = await requireAdmin();
  const parsed = parseLeaveTypeInput(leaveTypeFromForm(formData));
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const result = await createLeaveType(employee.orgId, parsed.value, { actorId: employee.id });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

export async function updateLeaveTypeAction(
  _prev: LeaveTypeFormState,
  formData: FormData,
): Promise<LeaveTypeFormState> {
  const { employee } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "leave type id is required" };

  const parsed = parseLeaveTypeInput(leaveTypeFromForm(formData));
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const result = await updateLeaveType(employee.orgId, id, parsed.value, { actorId: employee.id });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

export async function deleteLeaveTypeAction(
  _prev: LeaveTypeFormState,
  formData: FormData,
): Promise<LeaveTypeFormState> {
  const { employee } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "leave type id is required" };

  const result = await deleteLeaveType(employee.orgId, id, { actorId: employee.id });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}
