import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { postAdminPolicyAssignment } from "./[id]/assignments/route";
import { patchAdminPolicy } from "./[id]/route";
import { getAdminPolicies, postAdminPolicy } from "./route";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(path, "http://localhost"), init);
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

const unusedList = {
  list: async () => {
    throw new Error("must not list");
  },
  create: async () => {
    throw new Error("must not create");
  },
};

describe("GET/POST /api/admin/policies", () => {
  it("employee receives 403", async () => {
    const getRes = await getAdminPolicies(req("/api/admin/policies"), {
      ...employeeGate,
      ...unusedList,
    });
    expect(getRes.status).toBe(403);

    const postRes = await postAdminPolicy(
      req("/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leave_type_id: "11111111-1111-1111-1111-111111111111" }),
      }),
      { ...employeeGate, ...unusedList },
    );
    expect(postRes.status).toBe(403);
  });

  it("admin posting non-JSON receives 400", async () => {
    const res = await postAdminPolicy(
      req("/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        ...unusedList,
      },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid JSON" });
  });

  it("admin can list", async () => {
    const res = await getAdminPolicies(req("/api/admin/policies"), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      list: async () => [],
      create: async () => {
        throw new Error("unused");
      },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ policies: [] });
  });
});

describe("PATCH /api/admin/policies/:id", () => {
  it("employee receives 403", async () => {
    const res = await patchAdminPolicy(req("/api/admin/policies/p-1"), "p-1", {
      ...employeeGate,
      update: async () => {
        throw new Error("must not update");
      },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/policies/:id/assignments", () => {
  it("employee receives 403", async () => {
    const res = await postAdminPolicyAssignment(
      req("/api/admin/policies/p-1/assignments", { method: "POST" }),
      "p-1",
      {
        ...employeeGate,
        assign: async () => {
          throw new Error("must not assign");
        },
      },
    );
    expect(res.status).toBe(403);
  });

  it("admin assigns by employee_id + policy_id", async () => {
    const res = await postAdminPolicyAssignment(
      req("/api/admin/policies/11111111-1111-4111-8111-111111111111/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employee_id: "22222222-2222-4222-8222-222222222222",
          valid_from: "2026-01-01",
        }),
      }),
      "11111111-1111-4111-8111-111111111111",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        assign: async (orgId, input) => {
          expect(orgId).toBe("org-1");
          expect(input.policy_id).toBe("11111111-1111-4111-8111-111111111111");
          expect(input.employee_id).toBe("22222222-2222-4222-8222-222222222222");
          return {
            ok: true,
            updatedInPlace: true,
            assignment: {
              id: "asg-1",
              employeeId: input.employee_id,
              policyId: input.policy_id,
              leaveTypeId: "lt-1",
              validFrom: input.valid_from,
              validTo: null,
            },
          };
        },
      },
    );
    expect(res.status).toBe(200);
  });
});
