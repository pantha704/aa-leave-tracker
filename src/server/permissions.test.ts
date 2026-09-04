import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  isPermission,
  parsePermissions,
  permissionsForLegacyRole,
} from "./permissions";

describe("permission catalogue", () => {
  it("rejects strings that are not in the closed catalogue", () => {
    expect(isPermission("employee.read.self")).toBe(true);
    expect(isPermission("role === admin")).toBe(false);
    expect(isPermission("leave.approve.everything")).toBe(false);
    expect(parsePermissions(["employee.read.self", "not-a-perm", "employee.read.self"])).toEqual([
      "employee.read.self",
    ]);
  });

  it("maps legacy admin to org_admin permissions, not a global role check", () => {
    expect(permissionsForLegacyRole("admin")).toEqual(ROLE_PERMISSIONS.org_admin);
    expect(hasPermission({ role: "admin" }, "organization.manage")).toBe(true);
    expect(hasPermission({ role: "employee" }, "organization.manage")).toBe(false);
    expect(hasPermission({ role: "admin", permissions: [] }, "organization.manage")).toBe(false);
    expect(PERMISSIONS).toContain("leave.approve.direct_reports");
  });
});
