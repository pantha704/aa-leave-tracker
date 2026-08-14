import { describe, expect, it } from "vitest";
import {
  DEMO_MIN_INCREMENT_MINUTES,
  DEMO_WORKDAY_MINUTES,
} from "@/db/demo-policy";
import type { AuthzActor } from "@/server/authz";
import type { PolicySnapshot } from "@/server/policy/types";
import { MemoryLeaveStore } from "./memory";
import {
  hoursToMinutes,
  intentFromDates,
  parseCustomHours,
  submitLeave,
} from "./submit";

const MON = "2026-07-06";
const TUE = "2026-07-07";
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

function world(overrides: Partial<ConstructorParameters<typeof MemoryLeaveStore>[0]> = {}) {
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
    ...overrides,
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

function submit(
  store: MemoryLeaveStore,
  extras: Partial<Parameters<typeof submitLeave>[0]> = {},
  optionExtras: Partial<Parameters<typeof submitLeave>[1]> = {},
) {
  return submitLeave(
    {
      actor: alice,
      employeeId: store.employee.id,
      leaveTypeId: store.leaveType.id,
      startDate: MON,
      endDate: MON,
      portion: "full",
      ...extras,
    },
    { store, writeAudit: async () => undefined, ...optionExtras },
  );
}

describe("hoursToMinutes", () => {
  it("rounds one third of an 8h day from a decimal string", () => {
    expect(hoursToMinutes("2.67")).toBe(160);
    expect(hoursToMinutes("2.666666666")).toBe(160);
    expect(parseCustomHours(2.67).ok).toBe(false);
  });
});

describe("intentFromDates", () => {
  it("logs when end <= today and requests when start is in the future", () => {
    expect(intentFromDates("2026-06-01", "2026-06-01", TODAY)).toEqual({
      ok: true,
      intent: "log",
    });
    expect(intentFromDates(TODAY, TODAY, TODAY)).toEqual({ ok: true, intent: "log" });
    expect(intentFromDates(TODAY, MON, TODAY)).toEqual({ ok: true, intent: "request" });
    expect(intentFromDates(MON, TUE, TODAY)).toEqual({ ok: true, intent: "request" });
  });

  it("returns 422 when the range spans across today", () => {
    const result = intentFromDates("2026-06-01", MON, TODAY);
    expect(result).toMatchObject({ ok: false, status: 422, code: "SPAN_CROSSES_TODAY" });
  });
});

describe("submitLeave", () => {
  it("rejects a span across today with 422", async () => {
    const result = await submit(world(), {
      startDate: "2026-06-01",
      endDate: MON,
    });
    expect(result).toMatchObject({ ok: false, status: 422, code: "SPAN_CROSSES_TODAY" });
  });

  it("logs a past day, auto-approves when approval_for_log is none, and posts usage", async () => {
    const store = world();
    const result = await submit(store, {
      startDate: "2026-06-08",
      endDate: "2026-06-08",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toBe("log");
    expect(result.entry.status).toBe("approved");
    expect(result.ledgerPosted).toBe(true);
    expect(store.ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(1);
    expect(store.ledger.rows.find((row) => row.kind === "usage")).toMatchObject({
      effectiveOn: "2026-06-08",
      minutes: -DEMO_WORKDAY_MINUTES,
      leaveDayId: result.days[0]?.id,
    });
  });

  it("files a future request as pending with no ledger rows", async () => {
    const store = world();
    const result = await submit(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toBe("request");
    expect(result.entry.status).toBe("pending");
    expect(result.ledgerPosted).toBe(false);
    expect(store.ledger.rows.filter((row) => row.kind === "usage")).toHaveLength(0);
    expect(result.days[0]).toMatchObject({ onDate: MON, slotActive: true });
  });

  it("accepts customHours as a decimal string (1/3 of 8h)", async () => {
    const store = world();
    store.policy = { ...openPolicy, minIncrementMinutes: 20 };
    const result = await submit(store, {
      startDate: "2026-06-08",
      endDate: "2026-06-08",
      portion: "custom",
      customHours: "2.67",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.customMinutes).toBe(160);
    expect(result.days[0]?.minutes).toBe(160);
    expect(result.entry.totalMinutes).toBe(160);
  });

  it("forbids submitting for another employee", async () => {
    const result = await submit(world(), { actor: { id: "bob", role: "employee" } });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("lets admin submit on behalf", async () => {
    const result = await submit(world(), { actor: admin });
    expect(result.ok).toBe(true);
  });

  it("does not treat a client today field as the org clock", async () => {
    const store = world();
    const sneaky = {
      actor: alice,
      employeeId: store.employee.id,
      leaveTypeId: store.leaveType.id,
      startDate: MON,
      endDate: MON,
      portion: "full" as const,
      today: "2099-01-01",
    };
    const result = await submitLeave(sneaky, { store, writeAudit: async () => undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toBe("request");
    expect(result.entry.status).toBe("pending");
    expect(result.ledgerPosted).toBe(false);
  });

  it("checks negative balance in the year the days post, not year(today)", async () => {
    const store = world({
      today: "2026-12-15",
      periodStatuses: [
        { year: 2026, status: "open" },
        { year: 2027, status: "open" },
      ],
    });
    store.policy = { ...openPolicy, negativeAllowed: false };
    const result = await submit(store, {
      startDate: "2027-01-05",
      endDate: "2027-01-05",
    });
    expect(result).toMatchObject({ ok: false, status: 422, code: "NEGATIVE_BALANCE" });
  });

  it("returns NO_POLICY when the employee and type exist but assignment does not", async () => {
    const result = await submit(world({ hasPolicy: false }));
    expect(result).toMatchObject({ ok: false, status: 422, code: "NO_POLICY" });
  });

  it("still returns 200 when leave.pending notify throws", async () => {
    const store = world();
    const error = console.error;
    console.error = () => {};
    try {
      const result = await submit(
        store,
        {},
        {
          notify: async () => {
            throw new Error("resend down");
          },
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.status).toBe("pending");
    } finally {
      console.error = error;
    }
  });

  it("blocks writes when readonly / self-log / requests flags are off", async () => {
    const readonly = await submit(world({ orgSettings: { appReadonly: true } }), {
      startDate: "2026-06-08",
      endDate: "2026-06-08",
    });
    expect(readonly).toMatchObject({ ok: false, status: 403, code: "APP_READONLY" });

    const noLog = await submit(world({ orgSettings: { selfLogEnabled: false } }), {
      startDate: "2026-06-08",
      endDate: "2026-06-08",
    });
    expect(noLog).toMatchObject({ ok: false, status: 422, code: "SELF_LOG_DISABLED" });

    const noReq = await submit(world({ orgSettings: { requestsEnabled: false } }));
    expect(noReq).toMatchObject({ ok: false, status: 422, code: "REQUESTS_DISABLED" });
  });
});
