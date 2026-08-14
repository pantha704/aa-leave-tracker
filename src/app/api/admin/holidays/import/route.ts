import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  dbHolidayImportDeps,
  importHolidayCsv,
  type HolidayImportDeps,
  type HolidayImportResult,
} from "@/server/holidays/import";

export type AdminHolidayImportDeps = AdminGateDeps & {
  importCsv: (
    orgId: string,
    csv: string,
    holidayDeps: HolidayImportDeps,
  ) => Promise<HolidayImportResult>;
  holidayDeps: HolidayImportDeps;
};

const defaultDeps: AdminHolidayImportDeps = {
  ...defaultAdminGateDeps,
  importCsv: importHolidayCsv,
  holidayDeps: dbHolidayImportDeps,
};

async function readCsvBody(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("csv");
    if (file instanceof File) return file.text();
    if (typeof file === "string") return file;
    return null;
  }
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { csv?: unknown };
    return typeof body.csv === "string" ? body.csv : null;
  }
  return request.text();
}

export async function postAdminHolidaysImport(
  request: NextRequest,
  deps: AdminHolidayImportDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const csv = await readCsvBody(request);
  if (csv == null) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  const result = await deps.importCsv(gate.context.orgId, csv, deps.holidayDeps);
  if (!result.ok) {
    return NextResponse.json(
      { error: "csv_errors", errors: result.errors, errorCsv: result.errorCsv },
      { status: 400 },
    );
  }
  return NextResponse.json({ imported: result.imported, holidays: result.holidays });
}

export async function POST(request: NextRequest) {
  return postAdminHolidaysImport(request);
}
