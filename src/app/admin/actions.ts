"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { setAppReadonly } from "@/server/settings";

export type AdminSettingsState = { ok: true } | { ok: false; error: string } | undefined;

export async function setAppReadonlyAction(
  _prev: AdminSettingsState,
  formData: FormData,
): Promise<AdminSettingsState> {
  const { employee } = await requireAdmin();
  const raw = String(formData.get("appReadonly") ?? "");
  if (raw !== "true" && raw !== "false") {
    return { ok: false, error: "appReadonly must be true or false" };
  }

  await setAppReadonly({
    orgId: employee.orgId,
    appReadonly: raw === "true",
    actorId: employee.id,
  });
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/me");
  return { ok: true };
}
