import { eq } from "drizzle-orm";
import {
  membershipRoles,
  organizationMemberships,
  organizationRoles,
} from "@/db/schema-membership";
import { employees } from "@/db/schema";
import { getDb } from "./db";
import {
  parsePermissions,
  permissionsForLegacyRole,
  type Permission,
} from "./permissions";
import type { EmployeeRole } from "./auth-gate";
import type { AuthzActor } from "./authz";

export const ACTIVE_ORG_COOKIE = "aa-leave-org";

export function pickOrgId(headerList: Headers, fallback?: string | null): string | undefined {
  const fromCookie = headerList
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACTIVE_ORG_COOKIE}=`))
    ?.slice(ACTIVE_ORG_COOKIE.length + 1);
  const cookieOrg = fromCookie ? decodeURIComponent(fromCookie) : undefined;
  const headerOrg = headerList.get("x-organization-id")?.trim() || undefined;
  return headerOrg || cookieOrg || fallback || undefined;
}

export async function permissionsForEmployee(
  employeeId: string,
  legacyRole: string,
): Promise<readonly Permission[]> {
  const db = getDb();
  const rows = await db
    .select({ permissions: organizationRoles.permissions })
    .from(organizationMemberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, organizationMemberships.id))
    .innerJoin(organizationRoles, eq(organizationRoles.id, membershipRoles.roleId))
    .where(eq(organizationMemberships.employeeId, employeeId));

  if (rows.length === 0) {
    if (legacyRole === "admin" || legacyRole === "manager" || legacyRole === "employee") {
      return permissionsForLegacyRole(legacyRole);
    }
    return permissionsForLegacyRole("employee");
  }

  const merged: string[] = [];
  for (const row of rows) {
    merged.push(...row.permissions);
  }
  return parsePermissions(merged);
}

export async function toAuthzActor(employee: {
  id: string;
  orgId: string;
  role: string;
}): Promise<AuthzActor> {
  const role =
    employee.role === "admin" || employee.role === "manager" || employee.role === "employee"
      ? (employee.role as EmployeeRole)
      : "employee";
  return {
    id: employee.id,
    organizationId: employee.orgId,
    role,
    permissions: await permissionsForEmployee(employee.id, role),
  };
}

export async function employeesForAuthUser(authUserId: string, email: string) {
  const db = getDb();
  const byAuth = await db.select().from(employees).where(eq(employees.authUserId, authUserId));
  if (byAuth.length > 0) return byAuth;
  return db.select().from(employees).where(eq(employees.email, email));
}

export function selectEmployeeForOrg<T extends { orgId: string; active: boolean }>(
  rows: T[],
  preferredOrgId: string | undefined,
): T | undefined {
  const active = rows.filter((row) => row.active);
  if (preferredOrgId) {
    return active.find((row) => row.orgId === preferredOrgId) ?? active[0];
  }
  return active[0];
}
