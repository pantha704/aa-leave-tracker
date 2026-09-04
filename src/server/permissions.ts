import type { EmployeeRole } from "./auth-gate";

/** Closed permission catalogue. New checks must use these strings — not ad-hoc role names. */
export const PERMISSIONS = [
  "employee.read.self",
  "employee.read.team",
  "employee.read.all",
  "leave.request.self",
  "leave.cancel.self",
  "leave.read.team",
  "leave.approve.direct_reports",
  "leave.override.policy",
  "leave.read.all",
  "leave.approve.hr",
  "leave.approve.executive",
  "policy.read",
  "policy.manage",
  "ledger.read",
  "ledger.adjust",
  "employee.manage",
  "role.manage",
  "organization.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function parsePermissions(values: readonly string[]): Permission[] {
  const granted: Permission[] = [];
  for (const value of values) {
    if (isPermission(value) && !granted.includes(value)) granted.push(value);
  }
  return granted;
}

export const ROLE_KEYS = [
  "employee",
  "manager",
  "hr",
  "hr_admin",
  "executive",
  "org_admin",
  "payroll_viewer",
  "auditor",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

const EMPLOYEE_PERMISSIONS = [
  "employee.read.self",
  "leave.request.self",
  "leave.cancel.self",
] as const satisfies readonly Permission[];

const MANAGER_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  "employee.read.team",
  "leave.read.team",
  "leave.approve.direct_reports",
] as const satisfies readonly Permission[];

const HR_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  "employee.read.all",
  "leave.read.all",
  "leave.approve.hr",
  "leave.override.policy",
  "policy.read",
  "ledger.read",
  "employee.manage",
  "audit.read",
] as const satisfies readonly Permission[];

const ORG_ADMIN_PERMISSIONS = [
  ...HR_PERMISSIONS,
  "employee.read.team",
  "leave.read.team",
  "leave.approve.direct_reports",
  "leave.approve.executive",
  "policy.manage",
  "ledger.adjust",
  "role.manage",
  "organization.manage",
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  employee: EMPLOYEE_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  hr: HR_PERMISSIONS,
  hr_admin: ORG_ADMIN_PERMISSIONS,
  executive: [
    ...EMPLOYEE_PERMISSIONS,
    "employee.read.all",
    "leave.read.all",
    "leave.approve.executive",
    "audit.read",
  ],
  org_admin: ORG_ADMIN_PERMISSIONS,
  payroll_viewer: ["employee.read.all", "ledger.read", "policy.read"],
  auditor: ["employee.read.all", "leave.read.all", "ledger.read", "audit.read", "policy.read"],
};

export const LEGACY_ROLE_TO_KEY: Record<EmployeeRole, RoleKey> = {
  employee: "employee",
  manager: "manager",
  admin: "org_admin",
};

export function permissionsForLegacyRole(role: EmployeeRole): readonly Permission[] {
  return ROLE_PERMISSIONS[LEGACY_ROLE_TO_KEY[role]];
}

export type PermissionHolder = {
  permissions?: readonly Permission[];
  role?: EmployeeRole;
};

export function resolvedPermissions(holder: PermissionHolder | null | undefined): readonly Permission[] {
  if (!holder) return [];
  if (holder.permissions !== undefined) return holder.permissions;
  if (holder.role) return permissionsForLegacyRole(holder.role);
  return [];
}

export function hasPermission(
  holder: PermissionHolder | null | undefined,
  permission: Permission,
): boolean {
  return resolvedPermissions(holder).includes(permission);
}

export function canAccessAdminPortal(holder: PermissionHolder | null | undefined): boolean {
  return (
    hasPermission(holder, "organization.manage") ||
    hasPermission(holder, "employee.manage") ||
    hasPermission(holder, "policy.manage") ||
    hasPermission(holder, "ledger.adjust") ||
    hasPermission(holder, "leave.approve.hr") ||
    hasPermission(holder, "audit.read")
  );
}
