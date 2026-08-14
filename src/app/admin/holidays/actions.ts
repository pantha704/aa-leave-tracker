"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { dbHolidayImportDeps, importHolidayCsv } from "@/server/holidays/import";

export type HolidayImportState =
  | { ok: true; imported: number }
  | { ok: false; error: string; errors?: { line: number; message: string }[]; errorCsv?: string }
  | undefined;

export async function importHolidaysAction(
  _prev: HolidayImportState,
  formData: FormData,
): Promise<HolidayImportState> {
  const { employee } = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file" };
  }

  const csv = await file.text();
  const result = await importHolidayCsv(employee.orgId, csv, dbHolidayImportDeps);
  if (!result.ok) {
    return {
      ok: false,
      error: `${result.errors.length} row error(s)`,
      errors: result.errors,
      errorCsv: result.errorCsv,
    };
  }

  revalidatePath("/admin/holidays");
  return { ok: true, imported: result.imported };
}
