"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { authzActorFromEmployee } from "@/server/authz";
import { updateTeamCalendarFlags } from "@/server/calendar";

export async function setTeamCalendarEnabledAction(formData: FormData): Promise<void> {
  const { employee } = await requireAdmin();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const result = await updateTeamCalendarFlags({
    actor: authzActorFromEmployee(employee),
    orgId: employee.orgId,
    enabled,
  });
  if (!result.ok) return;
  revalidatePath("/calendar");
}

export async function setTeamCalendarShowTypeAction(formData: FormData): Promise<void> {
  const { employee } = await requireAdmin();
  const showType = String(formData.get("showType") ?? "") === "true";
  const result = await updateTeamCalendarFlags({
    actor: authzActorFromEmployee(employee),
    orgId: employee.orgId,
    showType,
  });
  if (!result.ok) return;
  revalidatePath("/calendar");
}
