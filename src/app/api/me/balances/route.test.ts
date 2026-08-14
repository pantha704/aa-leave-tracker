import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "@/server/audit";
import type { LedgerLine } from "@/server/balances";
import { getOwnBalances } from "./route";

const ownLine: LedgerLine = {
  id: "led-a",
  leaveTypeId: "lt",
  kind: "accrual",
  minutes: 680,
  effectiveOn: "2026-01-01",
  periodYear: 2026,
};

describe("GET /api/me/balances", () => {
  it("is own-only: ignores another employee id even if guessed in the URL", async () => {
    const loaded: string[] = [];
    const res = await getOwnBalances(
      new NextRequest(new URL("/api/me/balances?employeeId=bob", "http://localhost")),
      {
        getAuthzActor: async () => ({ id: "alice", role: "employee" }),
        writeAudit: async () => {
          throw new Error("own read is not audited");
        },
        loadLedger: async (id) => {
          loaded.push(id);
          return [ownLine];
        },
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ employeeId: "alice", ledger: [ownLine] });
    expect(loaded).toEqual(["alice"]);
  });

  it("returns 401 when anonymous", async () => {
    const res = await getOwnBalances(new NextRequest(new URL("/api/me/balances", "http://localhost")), {
      getAuthzActor: async () => null,
      writeAudit: async () => {
        throw new Error("must not audit");
      },
      loadLedger: async () => {
        throw new Error("must not load");
      },
    });
    expect(res.status).toBe(401);
  });
});
