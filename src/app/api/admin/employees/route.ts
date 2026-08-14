import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { listRoster, type RosterEmployee } from "@/server/admin/employees";

export type AdminEmployeesListDeps = AdminGateDeps & {
  listRoster: (input: { orgId: string; q?: string }) => Promise<RosterEmployee[]>;
};

const defaultDeps: AdminEmployeesListDeps = {
  ...defaultAdminGateDeps,
  listRoster,
};

export async function getAdminEmployees(
  request: NextRequest,
  deps: AdminEmployeesListDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const employees = await deps.listRoster({ orgId: gate.context.orgId, q });
  return NextResponse.json({ employees });
}

export async function GET(request: NextRequest) {
  return getAdminEmployees(request);
}
