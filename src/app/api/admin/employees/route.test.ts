import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAdminEmployees } from "./route";

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("GET /api/admin/employees", () => {
  it("employee receives 403", async () => {
    const res = await getAdminEmployees(req("/api/admin/employees"), {
      ...employeeGate,
      listRoster: async () => {
        throw new Error("must not list");
      },
    });
    expect(res.status).toBe(403);
  });

  it("admin lists roster rows", async () => {
    const res = await getAdminEmployees(req("/api/admin/employees?q=ada"), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      listRoster: async (input) => {
        expect(input).toEqual({ orgId: "org-1", q: "ada" });
        return [
          {
            id: "emp-1",
            name: "Ada",
            email: "ada@example.com",
            role: "employee",
            employmentType: "full_time",
            active: true,
            startDate: "2026-01-15",
            remainingVacationMinutes: 680,
            remainingVacationHours: "11.33",
            lastEntryDate: "2026-02-10",
          },
        ];
      },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      employees: [{ name: "Ada", remainingVacationHours: "11.33" }],
    });
  });
});
