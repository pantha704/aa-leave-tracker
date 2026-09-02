import { describe, expect, it } from "vitest";
import { ACTIVE_ORG_COOKIE, pickOrgId, selectEmployeeForOrg } from "./membership";

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

  it("ignores inactive memberships and unknown org ids", () => {
    expect(selectEmployeeForOrg(rows, "org-c")?.id).toBe("emp-a");
    expect(selectEmployeeForOrg(rows, undefined)?.id).toBe("emp-a");
    expect(selectEmployeeForOrg([], "org-a")).toBeUndefined();
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
