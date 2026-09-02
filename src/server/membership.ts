import { and, eq } from "drizzle-orm";
import {
  membershipRoles,
  organizationMemberships,
  organizationRoles,
} from "@/db/schema-membership";
import { employees } from "@/db/schema";
import { getDb } from "./db";
import { isUndefinedTable } from "./pg-error";
import {
  parsePermissions,
  permissionsForLegacyRole,
  type Permission,
  type RoleKey,
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

function legacyPermissions(legacyRole: string): readonly Permission[] {
  if (legacyRole === "admin" || legacyRole === "manager" || legacyRole === "employee") {
    return permissionsForLegacyRole(legacyRole);
  }
  return permissionsForLegacyRole("employee");
}

export async function permissionsForEmployee(
  employeeId: string,
  legacyRole: string,
): Promise<readonly Permission[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({ permissions: organizationRoles.permissions })
      .from(organizationMemberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, organizationMemberships.id))
      .innerJoin(organizationRoles, eq(organizationRoles.id, membershipRoles.roleId))
      .where(eq(organizationMemberships.employeeId, employeeId));

    if (rows.length === 0) return legacyPermissions(legacyRole);

    const merged: string[] = [];
    for (const row of rows) {
      merged.push(...row.permissions);
    }
    return parsePermissions(merged);
  } catch (err) {
    if (isUndefinedTable(err)) return legacyPermissions(legacyRole);
    throw err;
  }
}

export function roleKeyForEmployeeRole(role: string): RoleKey {
  if (role === "admin") return "org_admin";
  if (role === "manager") return "manager";
  return "employee";
}

export type MembershipWriter = {
  findRoleId(orgId: string, key: RoleKey): Promise<string | null>;
  insertMembership(row: {
    orgId: string;
    employeeId: string;
    authUserId: string | null;
  }): Promise<{ id: string }>;
  insertMembershipRole(row: { membershipId: string; roleId: string }): Promise<void>;
  setMembershipAuthUser(employeeId: string, authUserId: string): Promise<void>;
};

export async function attachInviteMembership(
  writer: MembershipWriter,
  input: {
    orgId: string;
    employeeId: string;
    role: string;
    authUserId?: string | null;
  },
): Promise<{ membershipId: string; roleKey: RoleKey }> {
  const roleKey = roleKeyForEmployeeRole(input.role);
  const roleId = await writer.findRoleId(input.orgId, roleKey);
  if (!roleId) {
    throw new Error(`organization role ${roleKey} is missing for this org`);
  }
  const membership = await writer.insertMembership({
    orgId: input.orgId,
    employeeId: input.employeeId,
    authUserId: input.authUserId ?? null,
  });
  await writer.insertMembershipRole({ membershipId: membership.id, roleId });
  return { membershipId: membership.id, roleKey };
}

type MembershipDb = {
  select: ReturnType<typeof getDb>["select"];
  insert: ReturnType<typeof getDb>["insert"];
  update: ReturnType<typeof getDb>["update"];
};

export function pgMembershipWriter(db: MembershipDb): MembershipWriter {
  return {
    async findRoleId(orgId, key) {
      const [row] = await db
        .select({ id: organizationRoles.id })
        .from(organizationRoles)
        .where(and(eq(organizationRoles.orgId, orgId), eq(organizationRoles.key, key)))
        .limit(1);
      return row?.id ?? null;
    },
    async insertMembership(row) {
      const [created] = await db
        .insert(organizationMemberships)
        .values({
          orgId: row.orgId,
          employeeId: row.employeeId,
          authUserId: row.authUserId,
        })
        .returning({ id: organizationMemberships.id });
      return created;
    },
    async insertMembershipRole(row) {
      await db.insert(membershipRoles).values({
        membershipId: row.membershipId,
        roleId: row.roleId,
      });
    },
    async setMembershipAuthUser(employeeId, authUserId) {
      await db
        .update(organizationMemberships)
        .set({ authUserId })
        .where(eq(organizationMemberships.employeeId, employeeId));
    },
  };
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

export function mergeEmployeesForAuthUser<T extends { id: string; authUserId: string | null }>(
  byAuthUserId: readonly T[],
  byEmail: readonly T[],
): T[] {
  const seen = new Set(byAuthUserId.map((row) => row.id));
  const extra = byEmail.filter((row) => !seen.has(row.id) && row.authUserId == null);
  return [...byAuthUserId, ...extra];
}

export async function employeesForAuthUser(authUserId: string, email: string) {
  const db = getDb();
  const byAuth = await db.select().from(employees).where(eq(employees.authUserId, authUserId));
  const byEmail = await db.select().from(employees).where(eq(employees.email, email));
  return mergeEmployeesForAuthUser(byAuth, byEmail);
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
