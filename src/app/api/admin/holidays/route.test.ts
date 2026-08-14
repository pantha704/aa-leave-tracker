import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAdminHolidays } from "./route";
import { postAdminHolidaysImport } from "./import/route";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(path, "http://localhost"), init);
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("GET /api/admin/holidays", () => {
  it("employee receives 403", async () => {
    const res = await getAdminHolidays(req("/api/admin/holidays"), {
      ...employeeGate,
      listHolidays: async () => {
        throw new Error("must not list");
      },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("admin lists an empty holiday table", async () => {
    const res = await getAdminHolidays(req("/api/admin/holidays"), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      listHolidays: async (orgId) => {
        expect(orgId).toBe("org-1");
        return [];
      },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ holidays: [] });
  });
});

describe("POST /api/admin/holidays/import", () => {
  it("employee receives 403", async () => {
    const res = await postAdminHolidaysImport(
      req("/api/admin/holidays/import", {
        method: "POST",
        body: "date,name\n2026-01-01,A",
        headers: { "content-type": "text/csv" },
      }),
      {
        ...employeeGate,
        importCsv: async () => {
          throw new Error("must not import");
        },
        holidayDeps: {
          loadExisting: async () => [],
          insertRows: async () => [],
        },
      },
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("returns error CSV payload for a bad date row", async () => {
    const res = await postAdminHolidaysImport(
      req("/api/admin/holidays/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: "date,name\nbad,A" }),
      }),
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        importCsv: async (orgId, csv, deps) => {
          const { importHolidayCsv } = await import("@/server/holidays/import");
          return importHolidayCsv(orgId, csv, deps);
        },
        holidayDeps: {
          loadExisting: async () => [],
          insertRows: async () => {
            throw new Error("must not insert");
          },
        },
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("csv_errors");
    expect(body.errorCsv).toContain("invalid date: bad");
  });
});
