"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { dbHolidayImportDeps, deleteHoliday, importHolidayCsv } from "@/server/holidays/import";

export type HolidayImportState =
  | { ok: true; imported: number; updated: number }
  | { ok: false; error: string; errors?: { line: number; message: string }[]; errorCsv?: string }
  | undefined;

function refresh() {
  revalidatePath("/admin/holidays");
}

export async function importHolidaysAction(
  _prev: HolidayImportState,
  formData: FormData,
): Promise<HolidayImportState> {
  const { employee } = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file" };
  }

  const replace = formData.get("replaceExisting");
  const csv = await file.text();
  const result = await importHolidayCsv(employee.orgId, csv, dbHolidayImportDeps, {
    mode: replace === "on" || replace === "true" || replace === "1" ? "upsert" : "insert",
    actorId: employee.id,
  });
  if (!result.ok) {
    if ("status" in result) {
      return { ok: false, error: result.error };
    }
    return {
      ok: false,
      error: `${result.errors.length} row error(s)`,
      errors: result.errors,
      errorCsv: result.errorCsv,
    };
  }

  refresh();
  return { ok: true, imported: result.imported, updated: result.updated };
}

export async function deleteHolidayAction(formData: FormData): Promise<void> {
  const { employee } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteHoliday(employee.orgId, id, { actorId: employee.id });
  refresh();
}
