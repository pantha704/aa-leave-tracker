import { NextRequest, NextResponse } from "next/server";
import { writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getAuthzActor } from "@/server/auth";
import { loadEmployeeLedger, readEmployeeBalances, type LoadLedger } from "@/server/balances";
import type { AuthzActor } from "@/server/authz";

export type MeBalancesDeps = {
  getAuthzActor: (request: NextRequest) => Promise<AuthzActor | null>;
  writeAudit: AuditWriter;
  loadLedger: LoadLedger;
};

const defaultDeps: MeBalancesDeps = {
  getAuthzActor,
  writeAudit: writeAuditEvent,
  loadLedger: loadEmployeeLedger,
};

export async function getOwnBalances(
  request: NextRequest,
  deps: MeBalancesDeps = defaultDeps,
) {
  const actor = await deps.getAuthzActor(request);
  const result = await readEmployeeBalances({
    actor,
    targetEmployeeId: actor?.id ?? "",
    writeAudit: deps.writeAudit,
    loadLedger: deps.loadLedger,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: NextRequest) {
  return getOwnBalances(request);
}
