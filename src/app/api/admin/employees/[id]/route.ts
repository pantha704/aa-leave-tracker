import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { loadEmployeeFile, type EmployeeFile } from "@/server/admin/employees";

export type AdminEmployeeFileDeps = AdminGateDeps & {
  loadFile: (input: { orgId: string; employeeId: string }) => Promise<EmployeeFile | null>;
};

const defaultDeps: AdminEmployeeFileDeps = {
  ...defaultAdminGateDeps,
  loadFile: loadEmployeeFile,
};

export async function getAdminEmployeeFile(
  request: NextRequest,
  employeeId: string,
  deps: AdminEmployeeFileDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const file = await deps.loadFile({ orgId: gate.context.orgId, employeeId });
  if (!file) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  return NextResponse.json(file);
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]">,
) {
  const { id } = await context.params;
  return getAdminEmployeeFile(request, id);
}
