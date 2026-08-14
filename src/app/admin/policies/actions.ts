"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import type { Balance } from "@/server/ledger/balance";
import {
  assignPolicy,
  createPolicy,
  loadSampleBalance,
  parseAssignmentInput,
  policyInputFromFormData,
  updatePolicy,
} from "@/server/policy/save";

export type PolicyFormState = { ok: true } | { ok: false; error: string } | undefined;

function refresh() {
  revalidatePath("/admin/policies");
}

export async function savePolicyAction(
  _prev: PolicyFormState,
  formData: FormData,
): Promise<PolicyFormState> {
  const { employee } = await requireAdmin();
  const parsed = policyInputFromFormData(formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const id = String(formData.get("id") ?? "").trim();
  const result = id
    ? await updatePolicy(employee.orgId, id, parsed.value, employee.id)
    : await createPolicy(employee.orgId, parsed.value, employee.id);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

export async function assignPolicyAction(
  _prev: PolicyFormState,
  formData: FormData,
): Promise<PolicyFormState> {
  const { employee } = await requireAdmin();
  const parsed = parseAssignmentInput({
    employee_id: String(formData.get("employee_id") ?? ""),
    policy_id: String(formData.get("policy_id") ?? ""),
    valid_from: String(formData.get("valid_from") ?? ""),
    valid_to: String(formData.get("valid_to") ?? "").trim() || null,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const result = await assignPolicy(employee.orgId, parsed.value, employee.id);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

export type SampleBalanceResult =
  | { ok: true; balance: Balance }
  | { ok: false; error: string };

export async function previewSampleBalanceAction(
  employeeId: string,
  leaveTypeId: string,
): Promise<SampleBalanceResult> {
  const { employee } = await requireAdmin();
  return loadSampleBalance(employee.orgId, employeeId, leaveTypeId);
}
