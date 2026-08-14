"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { updateTeamCalendarFlags } from "@/server/calendar";

export async function setTeamCalendarEnabledAction(formData: FormData): Promise<void> {
  const { employee } = await requireAdmin();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await updateTeamCalendarFlags({
    actor: { id: employee.id, role: "admin" },
    orgId: employee.orgId,
    enabled,
  });
  revalidatePath("/calendar");
}

export async function setTeamCalendarShowTypeAction(formData: FormData): Promise<void> {
  const { employee } = await requireAdmin();
  const showType = String(formData.get("showType") ?? "") === "true";
  await updateTeamCalendarFlags({
    actor: { id: employee.id, role: "admin" },
    orgId: employee.orgId,
    showType,
  });
  revalidatePath("/calendar");
}
