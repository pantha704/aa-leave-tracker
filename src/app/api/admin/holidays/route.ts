import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { loadOrgHolidays, type HolidayRecord } from "@/server/holidays/import";

export type AdminHolidaysDeps = AdminGateDeps & {
  listHolidays: (orgId: string) => Promise<HolidayRecord[]>;
};

const defaultDeps: AdminHolidaysDeps = {
  ...defaultAdminGateDeps,
  listHolidays: loadOrgHolidays,
};

export async function getAdminHolidays(
  request: NextRequest,
  deps: AdminHolidaysDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const rows = await deps.listHolidays(gate.context.orgId);
  return NextResponse.json({ holidays: rows });
}

export async function GET(request: NextRequest) {
  return getAdminHolidays(request);
}
