"use server";

import { requireAdmin } from "@/server/auth";
import { authzActorFromEmployee } from "@/server/authz";
import { createEmployeeWithInvite, defaultInviteDeps, issueInvite } from "@/server/invite";

export type CreateEmployeeState =
  | { error: string }
  | { invitePath: string; employeeId: string }
  | undefined;

export async function createEmployeeAction(
  _prev: CreateEmployeeState,
  formData: FormData,
): Promise<CreateEmployeeState> {
  const { employee } = await requireAdmin();
  const result = await createEmployeeWithInvite(
    {
      actor: { ...authzActorFromEmployee(employee), orgId: employee.orgId },
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      role: String(formData.get("role") ?? "employee"),
    },
    defaultInviteDeps(),
  );

  if (!result.ok) {
    return { error: result.error };
  }
  return { invitePath: result.invitePath, employeeId: result.employeeId };
}

export async function reissueInviteAction(
  _prev: CreateEmployeeState,
  formData: FormData,
): Promise<CreateEmployeeState> {
  const { employee } = await requireAdmin();
  const result = await issueInvite(
    {
      actor: { ...authzActorFromEmployee(employee), orgId: employee.orgId },
      employeeId: String(formData.get("employeeId") ?? ""),
    },
    defaultInviteDeps(),
  );
  if (!result.ok) {
    return { error: result.error };
  }
  return { invitePath: result.invitePath, employeeId: result.employeeId };
}
