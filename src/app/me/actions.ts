"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/server/auth";
import type { EmployeeRole } from "@/server/auth-gate";
import { formatHours } from "@/lib/hours";
import { leaveFieldsFromForm } from "@/lib/leave-fields";
import { submitLeave } from "@/server/leave/submit";
import type { Intent, Portion } from "@/server/policy/types";

const PORTIONS = new Set<Portion>(["full", "am", "pm", "custom"]);

export type LeaveFormState =
  | { ok: true; intent: Intent; status: string; hours: string }
  | { ok: false; code: string; message: string }
  | undefined;

export async function submitLeaveAction(
  _prev: LeaveFormState,
  formData: FormData,
): Promise<LeaveFormState> {
  const { employee } = await requireEmployee();
  const fields = leaveFieldsFromForm(formData);

  if (!fields.leaveTypeId) {
    return { ok: false, code: "INVALID_LEAVE_TYPE", message: "Choose a leave type." };
  }
  if (!PORTIONS.has(fields.portion as Portion)) {
    return { ok: false, code: "INVALID_PORTION", message: "portion must be full, am, pm, or custom" };
  }

  const result = await submitLeave({
    actor: { id: employee.id, role: employee.role as EmployeeRole },
    employeeId: employee.id,
    leaveTypeId: fields.leaveTypeId,
    startDate: fields.startDate,
    endDate: fields.endDate,
    portion: fields.portion as Portion,
    customHours: fields.portion === "custom" ? fields.customHours : null,
    note: fields.note,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath("/me");
  return {
    ok: true,
    intent: result.intent,
    status: result.entry.status,
    hours: formatHours(result.entry.totalMinutes),
  };
}
