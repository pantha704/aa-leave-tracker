import { NextRequest, NextResponse } from "next/server";
import { writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getAuthzActor } from "@/server/auth";
import { loadEmployeeLedger, readEmployeeBalances, type LoadLedger } from "@/server/balances";
import type { AuthzActor } from "@/server/authz";

export type AdminBalancesDeps = {
  getAuthzActor: (request: NextRequest) => Promise<AuthzActor | null>;
  writeAudit: AuditWriter;
  loadLedger: LoadLedger;
};

const defaultDeps: AdminBalancesDeps = {
  getAuthzActor,
  writeAudit: writeAuditEvent,
  loadLedger: loadEmployeeLedger,
};

export async function getAdminEmployeeBalances(
  request: NextRequest,
  employeeId: string,
  deps: AdminBalancesDeps = defaultDeps,
) {
  const actor = await deps.getAuthzActor(request);
  const result = await readEmployeeBalances({
    actor,
    targetEmployeeId: employeeId,
    requireAdmin: true,
    writeAudit: deps.writeAudit,
    loadLedger: deps.loadLedger,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/balances">,
) {
  const { id } = await context.params;
  return getAdminEmployeeBalances(request, id);
}
