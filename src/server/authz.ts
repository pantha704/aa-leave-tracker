import type { EmployeeRole } from "./auth-gate";
import {
  hasPermission,
  permissionsForLegacyRole,
  type Permission,
  type PermissionHolder,
} from "./permissions";

export type AuthzActor = PermissionHolder & {
  id: string;
  organizationId?: string;
  role?: EmployeeRole;
  permissions?: readonly Permission[];
};

export function authzActorFromEmployee(employee: {
  id: string;
  orgId: string;
  role: string;
}): AuthzActor {
  const role: EmployeeRole =
    employee.role === "admin" || employee.role === "manager" ? employee.role : "employee";
  return {
    id: employee.id,
    organizationId: employee.orgId,
    role,
    permissions: permissionsForLegacyRole(role),
  };
}

export type LeaveEntryAuthz = {
  employeeId: string;
  status: string;
  immutableAt: Date | string | null;
  startDate?: string;
  managerId?: string | null;
  organizationId?: string;
};

export type PeriodGate = {
  open: boolean;
  today: string;
};

export type OrgScoped = {
  organizationId?: string;
  managerId?: string | null;
};

const MUTABLE_STATUSES = new Set(["draft", "pending"]);

export function sameOrganization(
  actor: AuthzActor | null | undefined,
  resourceOrgId: string | undefined,
): boolean {
  if (!actor) return false;
  if (actor.organizationId && resourceOrgId && actor.organizationId !== resourceOrgId) {
    return false;
  }
  if (!actor.organizationId && resourceOrgId) return false;
  return true;
}

export function canAdmin(actor: AuthzActor | null | undefined): boolean {
  return hasPermission(actor, "organization.manage");
}

export function canCreateEmployee(actor: AuthzActor | null | undefined): boolean {
  return hasPermission(actor, "employee.manage");
}

export function canAdjustLedger(actor: AuthzActor | null | undefined): boolean {
  return hasPermission(actor, "ledger.adjust");
}

export function canReadEmployee(
  actor: AuthzActor | null | undefined,
  targetEmployeeId: string,
  target?: OrgScoped,
): boolean {
  if (!actor) return false;
  if (!sameOrganization(actor, target?.organizationId)) return false;
  if (actor.id === targetEmployeeId && hasPermission(actor, "employee.read.self")) return true;
  if (hasPermission(actor, "employee.read.all")) return true;
  return (
    hasPermission(actor, "employee.read.team") &&
    Boolean(target?.managerId) &&
    target?.managerId === actor.id
  );
}

function isOwner(actor: AuthzActor, employeeId: string): boolean {
  return actor.id === employeeId;
}

/** PATCH of dates/type/note. Approved rows are append-only (decide/adjust later). */
export function canWriteEntry(
  actor: AuthzActor | null | undefined,
  entry: LeaveEntryAuthz,
): boolean {
  if (!actor) return false;
  if (!sameOrganization(actor, entry.organizationId)) return false;
  if (entry.immutableAt != null) return false;
  if (!MUTABLE_STATUSES.has(entry.status)) return false;
  if (!canReadEmployee(actor, entry.employeeId, entry)) return false;
  if (isOwner(actor, entry.employeeId)) return true;
  return canCreateEmployee(actor);
}

/** Cancel via decide/reversal — not a PATCH. */
export function canCancelEntry(
  actor: AuthzActor | null | undefined,
  entry: LeaveEntryAuthz,
  period: PeriodGate,
): boolean {
  if (!actor) return false;
  if (!sameOrganization(actor, entry.organizationId)) return false;
  if (!canReadEmployee(actor, entry.employeeId, entry)) return false;

  if (entry.status === "draft" || entry.status === "pending") {
    if (isOwner(actor, entry.employeeId) && hasPermission(actor, "leave.cancel.self")) return true;
    return canCreateEmployee(actor);
  }

  if (entry.status !== "approved") return false;
  if (entry.immutableAt != null) return false;
  if (!period.open) return false;
  if (canCreateEmployee(actor) || canAdmin(actor)) return true;
  return (
    isOwner(actor, entry.employeeId) &&
    hasPermission(actor, "leave.cancel.self") &&
    Boolean(entry.startDate && entry.startDate > period.today)
  );
}

/**
 * Approve/reject someone else's request. Never self, even with HR/exec/manager
 * approve permissions. Direct-report approve is relationship-scoped.
 */
export function canApproveLeave(
  actor: AuthzActor | null | undefined,
  entry: Pick<LeaveEntryAuthz, "employeeId" | "organizationId" | "managerId">,
): boolean {
  if (!actor) return false;
  if (!sameOrganization(actor, entry.organizationId)) return false;
  if (actor.id === entry.employeeId) return false;
  if (hasPermission(actor, "leave.approve.hr") || hasPermission(actor, "leave.approve.executive")) {
    return true;
  }
  return (
    hasPermission(actor, "leave.approve.direct_reports") &&
    Boolean(entry.managerId) &&
    entry.managerId === actor.id
  );
}

export function canOverridePolicy(actor: AuthzActor | null | undefined): boolean {
  return hasPermission(actor, "leave.override.policy");
}
