import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { deleteAdminLeaveType, patchAdminLeaveType } from "./[id]/route";
import { getAdminLeaveTypes, postAdminLeaveType } from "./route";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(path, "http://localhost"), init);
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

const unused = {
  listTypes: async () => {
    throw new Error("must not list");
  },
  createType: async () => {
    throw new Error("must not create");
  },
};

describe("GET/POST /api/admin/leave-types", () => {
  it("employee receives 403", async () => {
    const getRes = await getAdminLeaveTypes(req("/api/admin/leave-types"), {
      ...employeeGate,
      ...unused,
    });
    expect(getRes.status).toBe(403);

    const postRes = await postAdminLeaveType(
      req("/api/admin/leave-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "wfh",
          name: "WFH",
          consumesBalance: false,
          legalUnit: "hours",
          minIncrementMinutes: null,
          color: null,
        }),
      }),
      { ...employeeGate, ...unused },
    );
    expect(postRes.status).toBe(403);
  });

  it("admin can list and create", async () => {
    const list = await getAdminLeaveTypes(req("/api/admin/leave-types"), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      listTypes: async () => [],
      createType: async () => {
        throw new Error("unused");
      },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ leaveTypes: [] });

    const created = {
      id: "lt-1",
      orgId: "org-1",
      code: "wfh",
      name: "WFH",
      consumesBalance: false,
      legalUnit: "hours",
      minIncrementMinutes: null,
      color: null,
      unlimited: false,
      visibleOnTeamCalendar: true,
    };
    const post = await postAdminLeaveType(
      req("/api/admin/leave-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "WFH",
          name: "WFH",
          consumesBalance: false,
          legalUnit: "hours",
          minIncrementMinutes: null,
          color: null,
        }),
      }),
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        listTypes: async () => [],
        createType: async (_orgId, input) => {
          expect(input.code).toBe("wfh");
          return { ok: true, leaveType: { ...created, ...input, id: "lt-1", orgId: "org-1" } };
        },
      },
    );
    expect(post.status).toBe(201);
  });

  it("invalid JSON body is 400", async () => {
    const res = await postAdminLeaveType(
      req("/api/admin/leave-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        ...unused,
      },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid JSON" });
  });
});

describe("DELETE /api/admin/leave-types/:id", () => {
  it("employee receives 403", async () => {
    const res = await deleteAdminLeaveType(req("/api/admin/leave-types/lt-1"), "lt-1", {
      ...employeeGate,
      updateType: async () => {
        throw new Error("must not update");
      },
      deleteType: async () => {
        throw new Error("must not delete");
      },
    });
    expect(res.status).toBe(403);
  });

  it("refuses delete when the type has entries", async () => {
    const res = await deleteAdminLeaveType(
      req("/api/admin/leave-types/lt-1", { method: "DELETE" }),
      "lt-1",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        updateType: async () => {
          throw new Error("unused");
        },
        deleteType: async () => ({
          ok: false,
          status: 409,
          error: "cannot delete leave type that has entries or related records",
        }),
      },
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "cannot delete leave type that has entries or related records",
    });
  });

  it("admin can patch a type", async () => {
    const res = await patchAdminLeaveType(
      req("/api/admin/leave-types/lt-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "sick",
          name: "Sick",
          consumesBalance: true,
          legalUnit: "days",
          minIncrementMinutes: 60,
          color: null,
        }),
      }),
      "lt-1",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        updateType: async (orgId, id, input) => {
          expect(orgId).toBe("org-1");
          expect(id).toBe("lt-1");
          return {
            ok: true,
            leaveType: { id, orgId, ...input },
          };
        },
        deleteType: async () => {
          throw new Error("unused");
        },
      },
    );
    expect(res.status).toBe(200);
  });
});
