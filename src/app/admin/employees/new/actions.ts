"use server";

import { requireAdmin } from "@/server/auth";
import type { EmployeeRole } from "@/server/auth-gate";
import { createEmployeeWithInvite, defaultInviteDeps } from "@/server/invite";

export type CreateEmployeeState =
  | { error: string }
  | { invitePath: string }
  | undefined;

export async function createEmployeeAction(
  _prev: CreateEmployeeState,
  formData: FormData,
): Promise<CreateEmployeeState> {
  const { employee } = await requireAdmin();
  const result = await createEmployeeWithInvite(
    {
      actor: {
        id: employee.id,
        role: employee.role as EmployeeRole,
        orgId: employee.orgId,
      },
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
  return { invitePath: result.invitePath };
}
