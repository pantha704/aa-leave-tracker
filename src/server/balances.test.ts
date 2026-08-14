import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "./audit";
import { readEmployeeBalances, type LedgerLine } from "./balances";
import type { AuthzActor } from "./authz";

const alice: AuthzActor = { id: "alice", role: "employee" };
const bob: AuthzActor = { id: "bob", role: "employee" };
const admin: AuthzActor = { id: "admin", role: "admin" };

const bobLine: LedgerLine = {
  id: "led-1",
  leaveTypeId: "lt-1",
  kind: "accrual",
  minutes: 680,
  effectiveOn: "2026-01-01",
  periodYear: 2026,
};

function captureAudit() {
  const events: AuditEventInput[] = [];
  return {
    events,
    writeAudit: async (input: AuditEventInput) => {
      events.push(input);
    },
  };
}

describe("IDOR: employee A cannot GET employee B ledger/balance", () => {
  it("returns 403 and does not load B's ledger", async () => {
    const { events, writeAudit } = captureAudit();
    let loaded: string | undefined;
    const result = await readEmployeeBalances({
      actor: alice,
      targetEmployeeId: bob.id,
      writeAudit,
      loadLedger: async (id) => {
        loaded = id;
        return [bobLine];
      },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "forbidden" });
    expect(loaded).toBeUndefined();
    expect(events).toEqual([
      {
        actorId: alice.id,
        action: "idor.denied",
        entityType: "employee",
        entityId: bob.id,
        after: { reason: "cross_employee" },
      },
    ]);
  });

  it("lets A read only A's ledger", async () => {
    const { events, writeAudit } = captureAudit();
    const own: LedgerLine = { ...bobLine, id: "led-own" };
    const result = await readEmployeeBalances({
      actor: alice,
      targetEmployeeId: alice.id,
      writeAudit,
      loadLedger: async (id) => {
        expect(id).toBe(alice.id);
        return [own];
      },
    });

    expect(result).toEqual({
      status: 200,
      body: { employeeId: alice.id, ledger: [own] },
    });
    expect(events).toEqual([]);
  });
});

describe("admin balance reads", () => {
  it("audits a successful read of another employee", async () => {
    const { events, writeAudit } = captureAudit();
    const result = await readEmployeeBalances({
      actor: admin,
      targetEmployeeId: bob.id,
      requireAdmin: true,
      writeAudit,
      loadLedger: async () => [bobLine],
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ employeeId: bob.id, ledger: [bobLine] });
    expect(events).toEqual([
      {
        actorId: admin.id,
        action: "employee.balances.read",
        entityType: "employee",
        entityId: bob.id,
        after: { lineCount: 1 },
      },
    ]);
  });

  it("rejects a non-admin on the admin route even for self", async () => {
    const { events, writeAudit } = captureAudit();
    const result = await readEmployeeBalances({
      actor: alice,
      targetEmployeeId: alice.id,
      requireAdmin: true,
      writeAudit,
      loadLedger: async () => {
        throw new Error("must not load");
      },
    });

    expect(result.status).toBe(403);
    expect(events[0]?.action).toBe("idor.denied");
  });

  it("still returns 403 when audit insert throws (non-uuid guess)", async () => {
    const prev = console.error;
    console.error = () => {};
    try {
    const result = await readEmployeeBalances({
      actor: alice,
      targetEmployeeId: "not-a-uuid",
      requireAdmin: true,
      writeAudit: async () => {
        throw new Error("invalid input syntax for type uuid");
      },
      loadLedger: async () => {
        throw new Error("must not load");
      },
    });
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "forbidden" });
    } finally {
      console.error = prev;
    }
  });

  it("still returns 200 when a successful admin read fails to audit", async () => {
    const prev = console.error;
    console.error = () => {};
    try {
    const result = await readEmployeeBalances({
      actor: admin,
      targetEmployeeId: bob.id,
      requireAdmin: true,
      writeAudit: async () => {
        throw new Error("audit down");
      },
      loadLedger: async () => [bobLine],
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ employeeId: bob.id, ledger: [bobLine] });
    } finally {
      console.error = prev;
    }
  });

  it("returns 401 when there is no actor", async () => {
    const result = await readEmployeeBalances({
      actor: null,
      targetEmployeeId: bob.id,
      writeAudit: async () => {
        throw new Error("must not audit");
      },
      loadLedger: async () => {
        throw new Error("must not load");
      },
    });
    expect(result.status).toBe(401);
  });
});
