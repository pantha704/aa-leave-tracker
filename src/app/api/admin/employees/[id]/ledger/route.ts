import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { isUuid, loadEmployeeFile, type EmployeeFile } from "@/server/admin/employees";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";

export type AdminEmployeeLedgerDeps = AdminGateDeps & {
  loadFile: (input: { orgId: string; employeeId: string }) => Promise<EmployeeFile | null>;
  writeAudit?: AuditWriter;
};

const defaultDeps: AdminEmployeeLedgerDeps = {
  ...defaultAdminGateDeps,
  loadFile: loadEmployeeFile,
  writeAudit: writeAuditEvent,
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
  if (!isUuid(employeeId)) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  const file = await deps.loadFile({ orgId: gate.context.orgId, employeeId });
  if (!file) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  await tryWriteAudit(deps.writeAudit ?? writeAuditEvent, {
    actorId: gate.context.actor.id,
    action: "employee.ledger.read",
    entityType: "employee",
    entityId: file.employee.id,
    after: { lineCount: file.ledger.length },
  });
  return NextResponse.json({ employeeId, ledger: file.ledger });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/ledger">,
) {
  const { id } = await context.params;
  return getAdminEmployeeLedger(request, id);
}
