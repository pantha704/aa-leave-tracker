import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { isUuid, loadEmployeeFile, type EmployeeFile } from "@/server/admin/employees";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";

export type AdminEmployeeFileDeps = AdminGateDeps & {
  loadFile: (input: { orgId: string; employeeId: string }) => Promise<EmployeeFile | null>;
  writeAudit?: AuditWriter;
};

const defaultDeps: AdminEmployeeFileDeps = {
  ...defaultAdminGateDeps,
  loadFile: loadEmployeeFile,
  writeAudit: writeAuditEvent,
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
  if (!isUuid(employeeId)) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  const file = await deps.loadFile({ orgId: gate.context.orgId, employeeId });
  if (!file) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }
  await tryWriteAudit(deps.writeAudit ?? writeAuditEvent, {
    actorId: gate.context.actor.id,
    action: "employee.file.read",
    entityType: "employee",
    entityId: file.employee.id,
    after: { ledgerCount: file.ledger.length, entryCount: file.entries.length },
  });
  return NextResponse.json(file);
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]">,
) {
  const { id } = await context.params;
  return getAdminEmployeeFile(request, id);
}
