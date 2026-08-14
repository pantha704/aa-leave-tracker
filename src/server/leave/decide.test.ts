import { describe, expect, it } from "vitest";
import {
  DEMO_MIN_INCREMENT_MINUTES,
  DEMO_WORKDAY_MINUTES,
} from "@/db/demo-policy";
import type { AuthzActor } from "@/server/authz";
import type { PolicySnapshot } from "@/server/policy/types";
import { decideLeave, nextStatus } from "./decide";
import { MemoryLeaveStore } from "./memory";
import { submitLeave } from "./submit";

const MON = "2026-07-06";
const TODAY = "2026-06-15";

const alice: AuthzActor = { id: "alice", role: "employee" };
const admin: AuthzActor = { id: "admin", role: "admin" };

const openPolicy: PolicySnapshot = {
  takeCeilingMinutes: null,
  minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
  negativeAllowed: true,
  waitingPeriodDays: 0,
  approvalForLog: "none",
  approvalForRequest: "admin",
  consumesBalance: true,
};

function world() {
  const employeeId = "alice";
  const leaveTypeId = "vacation";
  const store = new MemoryLeaveStore({
    today: TODAY,
    employee: {
      id: employeeId,
      startDate: "2020-01-01",
      workdayMinutes: DEMO_WORKDAY_MINUTES,
      role: "employee",
      managerId: null,
      orgWorkdayMinutes: DEMO_WORKDAY_MINUTES,
      weekendDays: [6, 7],
      timezone: "UTC",
    },
    leaveType: {
      id: leaveTypeId,
      consumesBalance: true,
      unlimited: false,
      minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
    },
    policy: openPolicy,
    periodStatuses: [{ year: 2026, status: "open" }],
    holidays: [],
  });
  store.ledger.post({
    employeeId,
    leaveTypeId,
    kind: "grant_lump",
    minutes: 20_000,
    effectiveOn: "2026-01-01",
    createdBy: "admin",
  });
  return store;
}

function submitMonday(store: MemoryLeaveStore) {
  return submitLeave(
    {
      actor: alice,
      employeeId: store.employee.id,
      leaveTypeId: store.leaveType.id,
      startDate: MON,
      endDate: MON,
      portion: "full",
    },
    { store, writeAudit: async () => undefined },
  );
}

describe("status machine", () => {
  it("allows draft → pending → approved|rejected|cancelled", () => {
    expect(nextStatus("draft", "cancel")).toBe("cancelled");
    expect(nextStatus("pending", "approve")).toBe("approved");
    expect(nextStatus("pending", "reject")).toBe("rejected");
    expect(nextStatus("pending", "cancel")).toBe("cancelled");
    expect(nextStatus("approved", "cancel")).toBe("cancelled");
    expect(nextStatus("approved", "approve")).toBeNull();
    expect(nextStatus("rejected", "cancel")).toBeNull();
  });
});

describe("decideLeave", () => {
  it("returns 423 APP_READONLY for approve, reject, and cancel", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    store.orgSettings = { ...store.orgSettings, appReadonly: true };

    for (const action of ["approve", "reject", "cancel"] as const) {
      const decided = await decideLeave(
        { actor: admin, entryId: submitted.entry.id, action },
        { store, writeAudit: async () => undefined },
      );
      expect(decided).toMatchObject({ ok: false, status: 423, code: "APP_READONLY" });
    }
    expect(store.entries[0]?.status).toBe("pending");
  });

  it("posts one usage row per LeaveDay on admin approve (effective_on = on_date)", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(store.ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(0);

    const decided = await decideLeave(
      { actor: admin, entryId: submitted.entry.id, action: "approve" },
      { store, writeAudit: async () => undefined },
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.entry.status).toBe("approved");
    expect(decided.ledgerPosted).toBe(true);
    const usage = store.ledger.rows.filter((row) => row.kind === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      effectiveOn: MON,
      minutes: -DEMO_WORKDAY_MINUTES,
      leaveEntryId: submitted.entry.id,
      leaveDayId: submitted.days[0]?.id,
    });
  });

  it("cancels pending Monday (slot_active=false) then allows a resubmit", async () => {
    const store = world();
    const first = await submitMonday(store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const cancelled = await decideLeave(
      { actor: alice, entryId: first.entry.id, action: "cancel" },
      { store, writeAudit: async () => undefined },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.entry.status).toBe("cancelled");
    expect(store.days.filter((day) => day.leaveEntryId === first.entry.id).every((day) => !day.slotActive)).toBe(
      true,
    );
    expect(store.ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(0);

    const second = await submitMonday(store);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(second.days[0]?.slotActive).toBe(true);
    expect(second.entry.status).toBe("pending");
  });

  it("lets the owner cancel approved-future when immutable_at is null and start > today", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    await decideLeave(
      { actor: admin, entryId: submitted.entry.id, action: "approve" },
      { store, writeAudit: async () => undefined },
    );
    expect(store.ledger.rows.filter((row) => row.kind === "usage" && row.reversedAt == null)).toHaveLength(1);

    const cancelled = await decideLeave(
      { actor: alice, entryId: submitted.entry.id, action: "cancel" },
      { store, writeAudit: async () => undefined, today: TODAY },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.entry.status).toBe("cancelled");
    expect(store.days.every((day) => !day.slotActive || day.leaveEntryId !== submitted.entry.id)).toBe(true);
    expect(store.ledger.rows.filter((row) => row.kind === "usage" && row.reversedAt == null)).toHaveLength(0);
    expect(store.ledger.rows.filter((row) => row.kind === "reversal")).toHaveLength(1);
  });

  it("does not let the owner cancel approved leave that has already started", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    await decideLeave(
      { actor: admin, entryId: submitted.entry.id, action: "approve" },
      { store, writeAudit: async () => undefined },
    );
    const denied = await decideLeave(
      { actor: alice, entryId: submitted.entry.id, action: "cancel" },
      { store, writeAudit: async () => undefined, today: MON },
    );
    expect(denied).toMatchObject({ ok: false, status: 403 });
  });

  it("posts the stored LeaveDays even if a holiday is added after submit", async () => {
    const store = world();
    const submitted = await submitLeave(
      {
        actor: alice,
        employeeId: store.employee.id,
        leaveTypeId: store.leaveType.id,
        startDate: MON,
        endDate: "2026-07-08",
        portion: "full",
      },
      { store, writeAudit: async () => undefined },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.days.map((day) => day.onDate)).toEqual([MON, "2026-07-07", "2026-07-08"]);

    store.holidays.push({ onDate: "2026-07-07" });
    const decided = await decideLeave(
      { actor: admin, entryId: submitted.entry.id, action: "approve" },
      { store, writeAudit: async () => undefined },
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    const usageOn = store.ledger.rows
      .filter((row) => row.kind === "usage")
      .map((row) => row.effectiveOn)
      .sort();
    expect(usageOn).toEqual([MON, "2026-07-07", "2026-07-08"]);
  });

  it("persists adminNote only for an admin actor", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const cancelled = await decideLeave(
      { actor: alice, entryId: submitted.entry.id, action: "cancel", adminNote: "secret" },
      { store, writeAudit: async () => undefined },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.entry.adminNote).toBeNull();

    const second = await submitMonday(store);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const rejected = await decideLeave(
      { actor: admin, entryId: second.entry.id, action: "reject", adminNote: "need coverage" },
      { store, writeAudit: async () => undefined },
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.entry.adminNote).toBe("need coverage");
  });

  it("rejects pending without posting usage and frees the slot", async () => {
    const store = world();
    const submitted = await submitMonday(store);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const rejected = await decideLeave(
      { actor: admin, entryId: submitted.entry.id, action: "reject" },
      { store, writeAudit: async () => undefined },
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.entry.status).toBe("rejected");
    expect(store.ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(0);
    const again = await submitMonday(store);
    expect(again.ok).toBe(true);
  });
});
