import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAdminEmployeeLedger } from "./ledger/route";
import { getAdminEmployeeFile } from "./route";
import type { EmployeeFile } from "@/server/admin/employees";

const PERSON = "44444444-4444-4444-8444-444444444444";

function fileReq(id: string) {
  return new NextRequest(new URL(`/api/admin/employees/${id}`, "http://localhost"));
}

function ledgerReq(id: string) {
  return new NextRequest(new URL(`/api/admin/employees/${id}/ledger`, "http://localhost"));
}

const unusedFile = async () => {
  throw new Error("must not load file");
};

const sampleFile = {
  employee: { id: PERSON, orgId: "org-1", name: "Ada" },
  ledger: [{ id: "led-1" }],
  entries: [{ id: "ent-1" }],
} as unknown as EmployeeFile;

describe("GET /api/admin/employees/:id", () => {
  it("employee receives 403 and loader is not called", async () => {
    const res = await getAdminEmployeeFile(fileReq(PERSON), PERSON, {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      loadFile: unusedFile,
    });
    expect(res.status).toBe(403);
  });

  it("admin other-org id is 404", async () => {
    const res = await getAdminEmployeeFile(fileReq(PERSON), PERSON, {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      loadFile: async (input) => {
        expect(input).toEqual({ orgId: "org-1", employeeId: PERSON });
        return null;
      },
    });
    expect(res.status).toBe(404);
  });

  it("non-uuid id is 404 without loading", async () => {
    const res = await getAdminEmployeeFile(fileReq("not-a-uuid"), "not-a-uuid", {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      loadFile: unusedFile,
    });
    expect(res.status).toBe(404);
  });

  it("admin file read is audited", async () => {
    const events: Array<{ action: string }> = [];
    const res = await getAdminEmployeeFile(fileReq(PERSON), PERSON, {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      loadFile: async () => sampleFile,
      writeAudit: async (event) => {
        events.push(event);
      },
    });
    expect(res.status).toBe(200);
    expect(events).toEqual([
      expect.objectContaining({
        action: "employee.file.read",
        entityType: "employee",
        entityId: PERSON,
      }),
    ]);
  });
});

describe("GET /api/admin/employees/:id/ledger", () => {
  it("employee receives 403", async () => {
    const res = await getAdminEmployeeLedger(ledgerReq(PERSON), PERSON, {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      loadFile: unusedFile,
    });
    expect(res.status).toBe(403);
  });

  it("admin other-org id is 404", async () => {
    const res = await getAdminEmployeeLedger(ledgerReq(PERSON), PERSON, {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      loadFile: async () => null,
    });
    expect(res.status).toBe(404);
  });
});
