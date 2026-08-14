import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@/server/ledger/post";
import { postAdminAdjustment } from "./route";

function req(body: unknown) {
  return new NextRequest(new URL("/api/admin/employees/emp-1/adjustments", "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("POST /api/admin/employees/:id/adjustments", () => {
  it("employee receives 403", async () => {
    const res = await postAdminAdjustment(req({ minutes: 60, reason: "x" }), "emp-1", {
      ...employeeGate,
      postAdjustment: async () => {
        throw new Error("must not adjust");
      },
    });
    expect(res.status).toBe(403);
  });

  it("admin posts an adjustment", async () => {
    const res = await postAdminAdjustment(
      req({
        leaveTypeId: "11111111-1111-4111-8111-111111111111",
        minutes: 60,
        effectiveOn: "2026-03-01",
        reason: "sheet correction",
      }),
      "emp-1",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        postAdjustment: async (input) => {
          expect(input.employeeId).toBe("emp-1");
          expect(input.raw).toMatchObject({ reason: "sheet correction", minutes: 60 });
          return { ok: true, row: { id: "led-1", minutes: 60 } as LedgerRow };
        },
      },
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ledgerEntry: { id: "led-1", minutes: 60 } });
  });
});
