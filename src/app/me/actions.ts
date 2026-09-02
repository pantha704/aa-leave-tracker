"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/server/auth";
import { authzActorFromEmployee } from "@/server/authz";
import { formatHours } from "@/lib/hours";
import { ownSubmitPayload } from "@/lib/leave-fields";
import { decideLeave } from "@/server/leave/decide";
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
  const actor = authzActorFromEmployee(employee);
  const fields = ownSubmitPayload(actor, formData);

  if (!fields.leaveTypeId) {
    return { ok: false, code: "INVALID_LEAVE_TYPE", message: "Choose a leave type." };
  }
  if (!PORTIONS.has(fields.portion as Portion)) {
    return { ok: false, code: "INVALID_PORTION", message: "portion must be full, am, pm, or custom" };
  }

  const result = await submitLeave({
    actor,
    employeeId: fields.employeeId,
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

export async function cancelLeaveAction(
  _prev: LeaveFormState,
  formData: FormData,
): Promise<LeaveFormState> {
  const { employee } = await requireEmployee();
  const entryId = String(formData.get("id") ?? "").trim();
  if (!entryId) {
    return { ok: false, code: "NOT_FOUND", message: "leave entry not found" };
  }

  const result = await decideLeave({
    actor: authzActorFromEmployee(employee),
    entryId,
    action: "cancel",
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
