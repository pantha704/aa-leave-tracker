import { describe, expect, it } from "vitest";
import {
  ACTIVE_ORG_COOKIE,
  attachInviteMembership,
  mergeEmployeesForAuthUser,
  permissionsFromOrgMemberships,
  pickOrgId,
  roleKeyForEmployeeRole,
  selectEmployeeForOrg,
  type MembershipWriter,
} from "./membership";
import { ROLE_PERMISSIONS } from "./permissions";

describe("selectEmployeeForOrg", () => {
  const rows = [
    { orgId: "org-a", active: true, id: "emp-a" },
    { orgId: "org-b", active: true, id: "emp-b" },
    { orgId: "org-c", active: false, id: "emp-c" },
  ];

  it("picks the preferred org membership for one identity", () => {
    expect(selectEmployeeForOrg(rows, "org-b")?.id).toBe("emp-b");
    expect(selectEmployeeForOrg(rows, "org-a")?.id).toBe("emp-a");
  });

  it("fails closed on unknown selector or ambiguous memberships", () => {
    expect(selectEmployeeForOrg(rows, "org-c")).toBeUndefined();
    expect(selectEmployeeForOrg(rows, undefined)).toBeUndefined();
    expect(selectEmployeeForOrg(rows.filter((row) => row.orgId === "org-a"), undefined)?.id).toBe(
      "emp-a",
    );
    expect(selectEmployeeForOrg([], "org-a")).toBeUndefined();
  });
});

describe("permissionsFromOrgMemberships", () => {
  it("does not union org-A admin permissions onto the org-B actor", () => {
    const rows = [
      { orgId: "org-a", permissions: ROLE_PERMISSIONS.org_admin },
      { orgId: "org-b", permissions: ROLE_PERMISSIONS.employee },
    ];
    const orgB = permissionsFromOrgMemberships(rows, "org-b");
    expect(orgB).toEqual([...ROLE_PERMISSIONS.employee]);
    expect(orgB).not.toContain("organization.manage");
    expect(permissionsFromOrgMemberships(rows, "org-a")).toContain("organization.manage");
  });
});

describe("mergeEmployeesForAuthUser", () => {
  it("unions auth-linked org-A with same-email unlinked org-B", () => {
    const linkedA = { id: "emp-a", authUserId: "user-1", orgId: "org-a" };
    const unlinkedB = { id: "emp-b", authUserId: null, orgId: "org-b" };
    const otherPerson = { id: "emp-c", authUserId: "user-2", orgId: "org-c" };
    const merged = mergeEmployeesForAuthUser([linkedA], [linkedA, unlinkedB, otherPerson]);
    expect(merged.map((row) => row.id)).toEqual(["emp-a", "emp-b"]);
  });

  it("does not drop auth matches when email lookup is empty", () => {
    const linked = { id: "emp-a", authUserId: "user-1" };
    expect(mergeEmployeesForAuthUser([linked], [])).toEqual([linked]);
  });
});

describe("attachInviteMembership", () => {
  it("writes membership then role using the org role catalogue", async () => {
    const writes: string[] = [];
    const writer: MembershipWriter = {
      async findRoleId(orgId, key) {
        writes.push(`find:${orgId}:${key}`);
        return "role-org-admin";
      },
      async insertMembership(row) {
        writes.push(`membership:${row.employeeId}:${row.authUserId}`);
        return { id: "mem-1" };
      },
      async insertMembershipRole(row) {
        writes.push(`role:${row.membershipId}:${row.roleId}`);
      },
      async setMembershipAuthUser() {
        writes.push("link");
      },
    };
    const result = await attachInviteMembership(writer, {
      orgId: "org-a",
      employeeId: "emp-1",
      role: "admin",
      authUserId: null,
    });
    expect(roleKeyForEmployeeRole("admin")).toBe("org_admin");
    expect(result).toEqual({ membershipId: "mem-1", roleKey: "org_admin" });
    expect(writes).toEqual([
      "find:org-a:org_admin",
      "membership:emp-1:null",
      "role:mem-1:role-org-admin",
    ]);
  });
});

describe("pickOrgId", () => {
  it("prefers the request header over the cookie", () => {
    const headers = new Headers({
      "x-organization-id": "org-header",
      cookie: `${ACTIVE_ORG_COOKIE}=org-cookie`,
    });
    expect(pickOrgId(headers)).toBe("org-header");
    expect(pickOrgId(new Headers({ cookie: `${ACTIVE_ORG_COOKIE}=org-cookie` }))).toBe("org-cookie");
  });
});
