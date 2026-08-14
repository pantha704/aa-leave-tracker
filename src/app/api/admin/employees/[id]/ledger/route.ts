import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { loadEmployeeFile, type EmployeeFile } from "@/server/admin/employees";

export type AdminEmployeeLedgerDeps = AdminGateDeps & {
  loadFile: (input: { orgId: string; employeeId: string }) => Promise<EmployeeFile | null>;
};

const defaultDeps: AdminEmployeeLedgerDeps = {
  ...defaultAdminGateDeps,
  loadFile: loadEmployeeFile,
};

export async function getAdminEmployeeLedger(
  request: NextRequest,
  employeeId: string,
  deps: AdminEmployeeLedgerDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const file = await deps.loadFile({ orgId: gate.context.orgId, employeeId });
  if (!file) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  return NextResponse.json({ employeeId, ledger: file.ledger });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/ledger">,
) {
  const { id } = await context.params;
  return getAdminEmployeeLedger(request, id);
}
