import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { writeAuditEvent } from "@/server/audit";
import {
  dbHolidayImportDeps,
  importHolidayCsv,
  type HolidayImportDeps,
  type HolidayImportMode,
  type HolidayImportOptions,
  type HolidayImportResult,
} from "@/server/holidays/import";

export type AdminHolidayImportDeps = AdminGateDeps & {
  importCsv: (
    orgId: string,
    csv: string,
    holidayDeps: HolidayImportDeps,
    options?: HolidayImportOptions,
  ) => Promise<HolidayImportResult>;
  holidayDeps: HolidayImportDeps;
};

const defaultDeps: AdminHolidayImportDeps = {
  ...defaultAdminGateDeps,
  importCsv: importHolidayCsv,
  holidayDeps: dbHolidayImportDeps,
};

function asMode(value: unknown): HolidayImportMode {
  return value === "upsert" ? "upsert" : "insert";
}

async function readImportBody(
  request: NextRequest,
): Promise<{ csv: string | null; mode: HolidayImportMode }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("csv");
    const replace = form.get("replaceExisting");
    const csv = file instanceof File ? await file.text() : typeof file === "string" ? file : null;
    return {
      csv,
      mode: replace === "true" || replace === "on" || replace === "1" ? "upsert" : asMode(form.get("mode")),
    };
  }
  if (contentType.includes("application/json")) {
    const body = await readJsonBody(request);
    if (!body.ok) return { csv: null, mode: "insert" };
    const value = body.value as { csv?: unknown; mode?: unknown };
    return {
      csv: typeof value.csv === "string" ? value.csv : null,
      mode: asMode(value.mode),
    };
  }
  return { csv: await request.text(), mode: "insert" };
}

export async function postAdminHolidaysImport(
  request: NextRequest,
  deps: AdminHolidayImportDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const { csv, mode } = await readImportBody(request);
  if (csv == null) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  const result = await deps.importCsv(gate.context.orgId, csv, deps.holidayDeps, {
    mode,
    actorId: gate.context.actor.id,
    writeAudit: writeAuditEvent,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "csv_errors", errors: result.errors, errorCsv: result.errorCsv },
      { status: 400 },
    );
  }
  return NextResponse.json({
    imported: result.imported,
    updated: result.updated,
    holidays: result.holidays,
  });
}

export async function POST(request: NextRequest) {
  return postAdminHolidaysImport(request);
}
