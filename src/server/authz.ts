import type { EmployeeRole } from "./auth-gate";

export type AuthzActor = {
  id: string;
  role: EmployeeRole;
};

export type LeaveEntryAuthz = {
  employeeId: string;
  status: string;
  immutableAt: Date | string | null;
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
): boolean {
  if (!actor) return false;
  return actor.role === "admin" || actor.id === targetEmployeeId;
}

/** PATCH of dates/type/note. Approved rows are append-only (decide/adjust later). */
export function canWriteEntry(
  actor: AuthzActor | null | undefined,
  entry: LeaveEntryAuthz,
): boolean {
  if (!actor) return false;
  if (entry.immutableAt != null) return false;
  if (!MUTABLE_STATUSES.has(entry.status)) return false;
  if (!canReadEmployee(actor, entry.employeeId)) return false;
  return actor.role === "admin" || actor.id === entry.employeeId;
}
