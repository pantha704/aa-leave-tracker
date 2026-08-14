import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "@/server/audit";
import type { LedgerLine } from "@/server/balances";
import { getAdminEmployeeBalances } from "./route";

const bobLine: LedgerLine = {
  id: "led-b",
  leaveTypeId: "lt",
  kind: "accrual",
  minutes: 480,
  effectiveOn: "2026-02-01",
  periodYear: 2026,
};

function req(id: string) {
  return new NextRequest(new URL(`/api/admin/employees/${id}/balances`, "http://localhost"));
}

describe("GET /api/admin/employees/:id/balances", () => {
  it("employee A cannot GET employee B ledger/balance (403)", async () => {
    const events: AuditEventInput[] = [];
    const res = await getAdminEmployeeBalances(req("bob"), "bob", {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      writeAudit: async (event) => {
        events.push(event);
      },
      loadLedger: async () => {
        throw new Error("must not load B");
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
    expect(events).toEqual([
      {
        actorId: "alice",
        action: "idor.denied",
        entityType: "employee",
        entityId: "bob",
        after: { reason: "admin_required" },
      },
    ]);
  });

  it("non-uuid IDOR guess still returns 403 when audit insert fails", async () => {
    const prev = console.error;
    console.error = () => {};
    try {
    const res = await getAdminEmployeeBalances(req("not-a-uuid"), "not-a-uuid", {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      writeAudit: async () => {
        throw new Error("invalid input syntax for type uuid");
      },
      loadLedger: async () => {
        throw new Error("must not load");
      },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
    } finally {
      console.error = prev;
    }
  });

  it("admin can GET another employee and the read is audited", async () => {
    const events: AuditEventInput[] = [];
    const res = await getAdminEmployeeBalances(req("bob"), "bob", {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      writeAudit: async (event) => {
        events.push(event);
      },
      loadLedger: async (id) => {
        expect(id).toBe("bob");
        return [bobLine];
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ employeeId: "bob", ledger: [bobLine] });
    expect(events).toEqual([
      {
        actorId: "admin",
        action: "employee.balances.read",
        entityType: "employee",
        entityId: "bob",
        after: { lineCount: 1 },
      },
    ]);
  });
});
