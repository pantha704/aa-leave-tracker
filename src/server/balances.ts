import { eq } from "drizzle-orm";
import { ledgerEntries } from "@/db/schema";
import { employeeInOrg, isUuid } from "@/server/admin/employees";
import { tryWriteAudit, type AuditWriter } from "./audit";
import { canAdmin, canReadEmployee, type AuthzActor } from "./authz";
import { getDb } from "./db";

export type LedgerLine = {
  id: string;
  leaveTypeId: string;
  kind: string;
  minutes: number;
  effectiveOn: string;
  periodYear: number;
};

export type LoadLedger = (employeeId: string) => Promise<LedgerLine[]>;

export type EmployeeInOrg = (orgId: string, employeeId: string) => Promise<boolean>;

export type BalanceReadResult =
  | { status: 200; body: { employeeId: string; ledger: LedgerLine[] } }
  | { status: 401; body: { error: string } }
  | { status: 403; body: { error: string } }
  | { status: 404; body: { error: string } };

export async function loadEmployeeLedger(employeeId: string): Promise<LedgerLine[]> {
  return getDb()
    .select({
      id: ledgerEntries.id,
      leaveTypeId: ledgerEntries.leaveTypeId,
      kind: ledgerEntries.kind,
      minutes: ledgerEntries.minutes,
      effectiveOn: ledgerEntries.effectiveOn,
      periodYear: ledgerEntries.periodYear,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.employeeId, employeeId));
}

export async function readEmployeeBalances(input: {
  actor: AuthzActor | null;
  targetEmployeeId: string;
  requireAdmin?: boolean;
  actorOrgId?: string | null;
  employeeInOrg?: EmployeeInOrg;
  writeAudit: AuditWriter;
  loadLedger: LoadLedger;
}): Promise<BalanceReadResult> {
  const { actor, targetEmployeeId, requireAdmin, writeAudit, loadLedger } = input;

  if (!actor) {
    return { status: 401, body: { error: "unauthenticated" } };
  }

  if (requireAdmin && !canAdmin(actor)) {
    await tryWriteAudit(writeAudit, {
      actorId: actor.id,
      action: "idor.denied",
      entityType: "employee",
      entityId: targetEmployeeId,
      after: { reason: "admin_required" },
    });
    return { status: 403, body: { error: "forbidden" } };
  }

  if (!canReadEmployee(actor, targetEmployeeId)) {
    await tryWriteAudit(writeAudit, {
      actorId: actor.id,
      action: "idor.denied",
      entityType: "employee",
      entityId: targetEmployeeId,
      after: { reason: "cross_employee" },
    });
    return { status: 403, body: { error: "forbidden" } };
  }

  if (requireAdmin) {
    const orgId = input.actorOrgId;
    if (!orgId) {
      return { status: 403, body: { error: "forbidden" } };
    }
    if (!isUuid(targetEmployeeId)) {
      return { status: 404, body: { error: "employee not found" } };
    }
    const inOrg = await (input.employeeInOrg ?? employeeInOrg)(orgId, targetEmployeeId);
    if (!inOrg) {
      return { status: 404, body: { error: "employee not found" } };
    }
  }

  const ledger = await loadLedger(targetEmployeeId);

  if (canAdmin(actor) && actor.id !== targetEmployeeId) {
    await tryWriteAudit(writeAudit, {
      actorId: actor.id,
      action: "employee.balances.read",
      entityType: "employee",
      entityId: targetEmployeeId,
      after: { lineCount: ledger.length },
    });
  }

  return { status: 200, body: { employeeId: targetEmployeeId, ledger } };
}
