import { describe, expect, it } from "vitest";
import { DEMO_SICK_GRANT_MINUTES } from "@/db/demo-policy";
import { MemoryLedger, SerialLock } from "./memory";
import {
  assertLiveGrantAvailable,
  employeeAdvisoryLockQuery,
  liveGrantOnceKey,
  prepareLedgerInsert,
  prepareReversal,
  signedLedgerMinutes,
} from "./post";

describe("advisory lock SQL", () => {
  it("uses transaction-level hashtextextended on employee_id (not FOR UPDATE)", () => {
    const query = employeeAdvisoryLockQuery("11111111-1111-1111-1111-111111111111");
    const compiled = JSON.stringify(query);
    expect(compiled).toContain("pg_advisory_xact_lock");
    expect(compiled).toContain("hashtextextended");
    expect(compiled).not.toMatch(/for update/i);
  });
});

describe("fixture (c) reopen + re-close: reverse grant then insert again", () => {
  it("sets reversed_at on the original and allows a new live grant_lump", () => {
    const ledger = new MemoryLedger();
    const actor = crypto.randomUUID();
    const employeeId = crypto.randomUUID();
    const leaveTypeId = crypto.randomUUID();

    const first = ledger.post({
      employeeId,
      leaveTypeId,
      kind: "grant_lump",
      minutes: DEMO_SICK_GRANT_MINUTES,
      effectiveOn: "2026-01-01",
      createdBy: actor,
      reason: "close:2025",
    });

    expect(() =>
      assertLiveGrantAvailable(ledger.rows, prepareLedgerInsert({
        employeeId,
        leaveTypeId,
        kind: "grant_lump",
        minutes: DEMO_SICK_GRANT_MINUTES,
        effectiveOn: "2026-01-01",
        createdBy: actor,
      })),
    ).toThrow(/live grant already exists/);

    const reversal = ledger.reverse(first.id, actor, "reopen:2026");
    expect(first.reversedAt).toBeInstanceOf(Date);
    expect(reversal.kind).toBe("reversal");
    expect(reversal.minutes).toBe(-first.minutes);
    expect(reversal.reversesId).toBe(first.id);
    expect(liveGrantOnceKey(first)).toBeNull();

    const second = ledger.post({
      employeeId,
      leaveTypeId,
      kind: "grant_lump",
      minutes: DEMO_SICK_GRANT_MINUTES,
      effectiveOn: "2026-01-01",
      createdBy: actor,
      reason: "close:2026",
    });

    expect(second.id).not.toBe(first.id);
    expect(ledger.rows.filter((row) => row.kind === "grant_lump")).toHaveLength(2);
    expect(ledger.rows.filter((row) => row.kind === "grant_lump" && row.reversedAt == null)).toHaveLength(
      1,
    );

    const bal = ledger.balance("2026-01-01");
    expect(bal.grantedMinutes).toBe(DEMO_SICK_GRANT_MINUTES);
    expect(bal.remainingMinutes).toBe(DEMO_SICK_GRANT_MINUTES);
  });

  it("refuses to reverse twice or reverse a reversal", () => {
    const posted = prepareLedgerInsert({
      employeeId: "e",
      leaveTypeId: "t",
      kind: "grant_lump",
      minutes: 1440,
      effectiveOn: "2026-01-01",
      createdBy: "a",
    });
    const original = { ...posted, id: "row-1" };
    const { reversal, reversedAt } = prepareReversal(original, { id: "row-1", createdBy: "a" });
    expect(reversal.minutes).toBe(-1440);

    expect(() =>
      prepareReversal({ ...original, reversedAt }, { id: "row-1", createdBy: "a" }),
    ).toThrow(/already reversed/);
    expect(() =>
      prepareReversal({ ...reversal, id: "rev-1" }, { id: "rev-1", createdBy: "a" }),
    ).toThrow(/cannot reverse a reversal/);
  });
});

describe("fixture (d) cancel Monday then submit Monday again", () => {
  it("reverses usage then posts the same Monday without losing history", () => {
    const ledger = new MemoryLedger();
    const actor = crypto.randomUUID();
    const employeeId = crypto.randomUUID();
    const leaveTypeId = crypto.randomUUID();
    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "accrual",
      minutes: 680,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });

    const monday = ledger.post({
      employeeId,
      leaveTypeId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: actor,
    });
    expect(monday.minutes).toBe(-480);
    expect(ledger.balance("2026-07-06").remainingMinutes).toBe(200);

    ledger.reverse(monday.id, actor, "cancel Monday");
    expect(ledger.balance("2026-07-06").remainingMinutes).toBe(680);
    expect(ledger.balance("2026-07-06").takenMinutes).toBe(0);

    const again = ledger.post({
      employeeId,
      leaveTypeId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: actor,
    });
    expect(again.id).not.toBe(monday.id);
    expect(ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(2);
    expect(ledger.rows.filter((row) => row.kind === "reversal")).toHaveLength(1);
    expect(ledger.balance("2026-07-06").remainingMinutes).toBe(200);
    expect(ledger.balance("2026-07-06").takenMinutes).toBe(480);
  });
});

describe("two concurrent first posts", () => {
  it("both succeed without losing a row when serialized by the employee lock", async () => {
    const ledger = new MemoryLedger();
    const lock = new SerialLock();
    const employeeId = crypto.randomUUID();
    const leaveTypeId = crypto.randomUUID();
    const createdBy = crypto.randomUUID();

    const postFirst = (minutes: number) =>
      lock.withLock(employeeId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ledger.post({
          employeeId,
          leaveTypeId,
          kind: "adjustment",
          minutes,
          effectiveOn: "2026-01-01",
          createdBy,
          reason: "opening",
        });
      });

    const [a, b] = await Promise.all([postFirst(60), postFirst(120)]);
    expect(a.id).not.toBe(b.id);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows.reduce((sum, row) => sum + row.minutes, 0)).toBe(180);
    expect(ledger.balance("2026-01-01").grantedMinutes).toBe(180);
  });
});

describe("append-only post", () => {
  it("never mutates minutes on prepare — INSERT payload only", () => {
    const row = prepareLedgerInsert({
      employeeId: "e",
      leaveTypeId: "t",
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: "a",
    });
    expect(row.reversedAt).toBeNull();
    expect(row.kind).toBe("usage");
    expect(row.minutes).toBe(signedLedgerMinutes("usage", 480));
  });
});
