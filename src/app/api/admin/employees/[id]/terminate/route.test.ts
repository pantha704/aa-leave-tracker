import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { TerminateResult } from "@/server/terminate";
import { postAdminTerminate } from "./route";

function req(body: unknown) {
  return new NextRequest(new URL("/api/admin/employees/emp-1/terminate", "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("POST /api/admin/employees/:id/terminate", () => {
  it("employee receives 403", async () => {
    const res = await postAdminTerminate(req({ endDate: "2026-06-30", reason: "x" }), "emp-1", {
      ...employeeGate,
      terminate: async () => {
        throw new Error("must not terminate");
      },
    });
    expect(res.status).toBe(403);
  });

  it("admin terminates and receives the two-column CSV link", async () => {
    const payload: TerminateResult = {
      employee: { id: "emp-1", endDate: "2026-06-30", active: false },
      cancelledPending: 1,
      reversedUsage: 2,
      lockedEntries: 3,
      filename: "termination-2026-06-30.csv",
      downloadPath: "/api/admin/export/termination.csv?employeeId=emp-1&endDate=2026-06-30",
      csv: "email,leave_type,end_date,ledger_remaining,pro_rata_earned_to_end_date\n",
    };
    const res = await postAdminTerminate(
      req({ endDate: "2026-06-30", reason: "last day" }),
      "emp-1",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        terminate: async (input) => {
          expect(input.employeeId).toBe("emp-1");
          expect(input.raw).toMatchObject({ endDate: "2026-06-30", reason: "last day" });
          return { ok: true, ...payload };
        },
      },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      downloadPath: payload.downloadPath,
      csv: payload.csv,
    });
  });
});
