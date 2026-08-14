import type { EmployeeRole } from "./auth-gate";

export type AuthzActor = {
  id: string;
  role: EmployeeRole;
};

export type LeaveEntryAuthz = {
  employeeId: string;
  status: string;
  immutableAt: Date | string | null;
  startDate?: string;
  managerId?: string | null;
};

export type PeriodGate = {
  open: boolean;
  today: string;
};

const MUTABLE_STATUSES = new Set(["draft", "pending"]);

export function canAdmin(actor: AuthzActor | null | undefined): boolean {
  return actor?.role === "admin";
}

export function canAdjustLedger(actor: AuthzActor | null | undefined): boolean {
  return canAdmin(actor);
}

export function canReadEmployee(
  actor: AuthzActor | null | undefined,
  targetEmployeeId: string,
  target?: { managerId?: string | null },
): boolean {
  if (!actor) return false;
  if (actor.role === "admin" || actor.id === targetEmployeeId) return true;
  return actor.role === "manager" && target?.managerId === actor.id;
}

function isOwnerOrAdmin(actor: AuthzActor, employeeId: string): boolean {
  return canAdmin(actor) || actor.id === employeeId;
}

/** PATCH of dates/type/note. Approved rows are append-only (decide/adjust later). */
export function canWriteEntry(
  actor: AuthzActor | null | undefined,
  entry: LeaveEntryAuthz,
): boolean {
  if (!actor) return false;
  if (entry.immutableAt != null) return false;
  if (!MUTABLE_STATUSES.has(entry.status)) return false;
  if (!canReadEmployee(actor, entry.employeeId, { managerId: entry.managerId })) return false;
  return isOwnerOrAdmin(actor, entry.employeeId);
}

/** Cancel via decide/reversal — not a PATCH. */
export function canCancelEntry(
  actor: AuthzActor | null | undefined,
  entry: LeaveEntryAuthz,
  period: PeriodGate,
): boolean {
  if (!actor) return false;
  if (!canReadEmployee(actor, entry.employeeId, { managerId: entry.managerId })) return false;

  if (entry.status === "draft" || entry.status === "pending") {
    return isOwnerOrAdmin(actor, entry.employeeId);
  }

  if (entry.status !== "approved") return false;
  if (entry.immutableAt != null) return false;
  if (!period.open) return false;
  if (canAdmin(actor)) return true;
  return actor.id === entry.employeeId && Boolean(entry.startDate && entry.startDate > period.today);
}
