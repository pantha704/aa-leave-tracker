import { NextRequest, NextResponse } from "next/server";
import { employeeInOrg } from "@/server/admin/employees";
import { loadActorOrgId } from "@/server/admin-api";
import { writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getAuthzActor } from "@/server/auth";
import {
  loadEmployeeLedger,
  readEmployeeBalances,
  type EmployeeInOrg,
  type LoadLedger,
} from "@/server/balances";
import type { AuthzActor } from "@/server/authz";

export type AdminBalancesDeps = {
  getAuthzActor: (request: NextRequest) => Promise<AuthzActor | null>;
  writeAudit: AuditWriter;
  loadLedger: LoadLedger;
  loadOrgId: (actorId: string) => Promise<string | null>;
  employeeInOrg: EmployeeInOrg;
};

const defaultDeps: AdminBalancesDeps = {
  getAuthzActor,
  writeAudit: writeAuditEvent,
  loadLedger: loadEmployeeLedger,
  loadOrgId: loadActorOrgId,
  employeeInOrg,
};

export async function getAdminEmployeeBalances(
  request: NextRequest,
  employeeId: string,
  deps: AdminBalancesDeps = defaultDeps,
) {
  const actor = await deps.getAuthzActor(request);
  const actorOrgId =
    actor?.role === "admin" ? await deps.loadOrgId(actor.id) : null;
  const result = await readEmployeeBalances({
    actor,
    targetEmployeeId: employeeId,
    requireAdmin: true,
    actorOrgId,
    employeeInOrg: deps.employeeInOrg,
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
