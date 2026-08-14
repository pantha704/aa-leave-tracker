import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEMO_SICK_GRANT_MINUTES,
  DEMO_VACATION_GRANT_MINUTES,
  DEMO_VACATION_PERIODIC_MINUTES,
  DEMO_VACATION_TYPE_CODE,
} from "@/db/demo-policy";
import { MemoryLedger } from "@/server/ledger/memory";
import {
  applyClosePeriods,
  applyOpenPeriod,
  applyPlannedPostsToMemory,
  applyReopenPeriods,
  computeCarryAndForfeit,
  executeCloseOnWorld,
  executeReopenOnWorld,
  isPeriodOpen,
  parseCalendarYear,
  planFirstYearOpen,
  planReopen,
  planSickAllotment,
  planYearClose,
  writeYearEndSnapshotFile,
  type YearEndWorld,
} from "./year-end";

const actor = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const employeeId = "11111111-1111-1111-1111-111111111111";
const vacationId = "22222222-2222-2222-2222-222222222222";
const sickId = "33333333-3333-3333-3333-333333333333";
const vacationPolicyId = "44444444-4444-4444-4444-444444444444";
const sickPolicyId = "55555555-5555-5555-5555-555555555555";

function baseWorld(overrides: Partial<YearEndWorld> = {}): YearEndWorld {
  return {
    orgId: "org-1",
    weekendDays: [6, 7],
    holidays: new Set(),
    periods: new Map<number, "future" | "open" | "closing" | "closed">([[2026, "open"]]),
    employees: [
      {
        id: employeeId,
        name: "Ada",
        active: true,
        startDate: "2026-01-01",
        endDate: null,
      },
    ],
    leaveTypes: [
      { id: vacationId, code: DEMO_VACATION_TYPE_CODE, consumesBalance: true },
      { id: sickId, code: "sick", consumesBalance: true },
    ],
    policies: [
      {
        id: vacationPolicyId,
        leaveTypeId: vacationId,
        grantMode: "periodic",
        grantMinutes: DEMO_VACATION_GRANT_MINUTES,
        periodicCadence: "monthly",
        periodicMinutes: DEMO_VACATION_PERIODIC_MINUTES,
        carryoverMaxMinutes: null,
        allowForfeit: false,
        accrualStopMinutes: null,
      },
      {
        id: sickPolicyId,
        leaveTypeId: sickId,
        grantMode: "lump_sum",
        grantMinutes: DEMO_SICK_GRANT_MINUTES,
        periodicCadence: null,
        periodicMinutes: null,
        carryoverMaxMinutes: null,
        allowForfeit: false,
        accrualStopMinutes: null,
      },
    ],
    assignments: [
      {
        employeeId,
        policyId: vacationPolicyId,
        leaveTypeId: vacationId,
        validFrom: "2026-01-01",
        validTo: null,
      },
      {
        employeeId,
        policyId: sickPolicyId,
        leaveTypeId: sickId,
        validFrom: "2026-01-01",
        validTo: null,
      },
    ],
    ledger: [],
    ...overrides,
  };
}

function worldFromLedger(ledger: MemoryLedger, periods: Map<number, "future" | "open" | "closing" | "closed">) {
  return baseWorld({
    periods,
    ledger: ledger.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      minutes: row.minutes,
      effectiveOn: row.effectiveOn,
      periodYear: row.periodYear,
      reversedAt: row.reversedAt,
      employeeId: row.employeeId,
      leaveTypeId: row.leaveTypeId,
      reason: row.reason,
    })),
  });
}

describe("carryover math", () => {
  it("does not forfeit unused when allow_forfeit is off", () => {
    expect(
      computeCarryAndForfeit({
        unusedMinutes: 2000,
        carryoverMaxMinutes: 480,
        allowForfeit: false,
      }),
    ).toEqual({ carryMinutes: 480, forfeitMinutes: 0 });
  });

  it("writes forfeit only when allowed", () => {
    expect(
      computeCarryAndForfeit({
        unusedMinutes: 2000,
        carryoverMaxMinutes: 480,
        allowForfeit: true,
      }),
    ).toEqual({ carryMinutes: 480, forfeitMinutes: 1520 });
  });

  it("carries all when cap is null", () => {
    expect(
      computeCarryAndForfeit({
        unusedMinutes: 2000,
        carryoverMaxMinutes: null,
        allowForfeit: false,
      }),
    ).toEqual({ carryMinutes: 2000, forfeitMinutes: 0 });
  });
});

describe("sick allotment on period open", () => {
  it("grants the full 3-day lump on Jan 1 for a year-start hire", () => {
    expect(
      planSickAllotment({
        grantMinutes: DEMO_SICK_GRANT_MINUTES,
        startDate: "2027-01-01",
        year: 2027,
      }),
    ).toEqual({ minutes: DEMO_SICK_GRANT_MINUTES, effectiveOn: "2027-01-01" });
  });

  it("prorates a mid-year hire by remaining working days", () => {
    const planned = planSickAllotment({
      grantMinutes: DEMO_SICK_GRANT_MINUTES,
      startDate: "2026-07-01",
      year: 2026,
    });
    expect(planned?.effectiveOn).toBe("2026-07-01");
    expect(planned?.minutes).toBeGreaterThan(0);
    expect(planned?.minutes).toBeLessThan(DEMO_SICK_GRANT_MINUTES);
  });
});

describe("close writes carryover not lump", () => {
  it("posts Y+1 carryover + sick grant_lump and no vacation grant_lump", () => {
    const ledger = new MemoryLedger();
    for (let month = 1; month <= 12; month++) {
      ledger.post({
        employeeId,
        leaveTypeId: vacationId,
        kind: "accrual",
        minutes: DEMO_VACATION_PERIODIC_MINUTES,
        effectiveOn: `2026-${String(month).padStart(2, "0")}-01`,
        createdBy: actor,
      });
    }
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: actor,
    });

    const periods = new Map<number, "future" | "open" | "closing" | "closed">([
      [2026, "open"],
      [2027, "future"],
    ]);
    const planned = planYearClose(worldFromLedger(ledger, periods), 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.plan.posts.some((post) => post.kind === "grant_lump" && post.leaveTypeId === vacationId)).toBe(
      false,
    );
    expect(planned.plan.preview.every((row) => row.writesVacationLump === false)).toBe(true);

    applyPlannedPostsToMemory(ledger, planned.plan.posts, actor);
    applyClosePeriods(periods, 2026);

    const carry = ledger.rows.filter((row) => row.kind === "carryover" && row.reversedAt == null);
    expect(carry).toHaveLength(1);
    expect(carry[0]?.leaveTypeId).toBe(vacationId);
    expect(carry[0]?.effectiveOn).toBe("2027-01-01");
    expect(carry[0]?.periodYear).toBe(2027);
    expect(carry[0]?.minutes).toBe(DEMO_VACATION_GRANT_MINUTES - 480);
    expect(carry[0]?.reason).toBe("close:2026");

    const sick = ledger.rows.filter(
      (row) => row.kind === "grant_lump" && row.leaveTypeId === sickId && row.reversedAt == null,
    );
    expect(sick).toHaveLength(1);
    expect(sick[0]?.minutes).toBe(DEMO_SICK_GRANT_MINUTES);
    expect(sick[0]?.effectiveOn).toBe("2027-01-01");
    expect(sick[0]?.reason).toBe("close:2026");

    expect(
      ledger.rows.some(
        (row) => row.kind === "grant_lump" && row.leaveTypeId === vacationId && row.periodYear === 2027,
      ),
    ).toBe(false);
    expect(ledger.rows.some((row) => row.kind === "forfeit")).toBe(false);
    expect(periods.get(2026)).toBe("closed");
    expect(periods.get(2027)).toBe("open");
  });

  it("does not delete unused when forfeit is off and a cap applies", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: 2000,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(ledger, new Map([[2026, "open"]]));
    world.policies = world.policies.map((policy) =>
      policy.id === vacationPolicyId ? { ...policy, carryoverMaxMinutes: 480, allowForfeit: false } : policy,
    );
    const planned = planYearClose(world, 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const vacationPreview = planned.plan.preview.find((row) => row.leaveTypeId === vacationId);
    expect(vacationPreview).toMatchObject({
      unusedMinutes: 2000,
      carryMinutes: 480,
      forfeitMinutes: 0,
    });
    expect(planned.plan.posts.some((post) => post.kind === "forfeit")).toBe(false);
  });
});

describe("reopen reverses close-created grants", () => {
  it("sets reversed_at on carryover and sick grant then allows a second close", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: DEMO_VACATION_GRANT_MINUTES,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const periods = new Map<number, "future" | "open" | "closing" | "closed">([
      [2026, "open"],
      [2027, "future"],
    ]);

    const first = planYearClose(worldFromLedger(ledger, periods), 2026);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    applyPlannedPostsToMemory(ledger, first.plan.posts, actor);
    applyClosePeriods(periods, 2026);

    const afterClose = worldFromLedger(ledger, periods);
    const reopen = planReopen(afterClose, 2026);
    expect(reopen.ok).toBe(true);
    if (!reopen.ok) return;
    for (const id of reopen.reverseIds) {
      ledger.reverse(id, actor, "reopen:2026");
    }
    applyReopenPeriods(periods, 2026);

    const carry = ledger.rows.find((row) => row.kind === "carryover");
    const sick = ledger.rows.find((row) => row.kind === "grant_lump" && row.leaveTypeId === sickId);
    expect(carry?.reversedAt).toBeInstanceOf(Date);
    expect(sick?.reversedAt).toBeInstanceOf(Date);
    expect(periods.get(2026)).toBe("open");
    expect(periods.get(2027)).toBe("future");

    const second = planYearClose(worldFromLedger(ledger, periods), 2026);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    applyPlannedPostsToMemory(ledger, second.plan.posts, actor);
    applyClosePeriods(periods, 2026);
    expect(ledger.rows.filter((row) => row.kind === "carryover" && row.reversedAt == null)).toHaveLength(1);
    expect(
      ledger.rows.filter((row) => row.kind === "grant_lump" && row.leaveTypeId === sickId && row.reversedAt == null),
    ).toHaveLength(1);
  });

  it("refuses reopen when Y+1 has live non-close activity", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "carryover",
      minutes: 480,
      effectiveOn: "2027-01-01",
      reason: "close:2026",
      createdBy: actor,
    });
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: DEMO_VACATION_PERIODIC_MINUTES,
      effectiveOn: "2027-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(
      ledger,
      new Map([
        [2026, "closed"],
        [2027, "open"],
      ]),
    );
    const reopen = planReopen(world, 2026);
    expect(reopen.ok).toBe(false);
  });
});

describe("first-year open", () => {
  it("writes sick grant_lump and never a 17-day vacation lump", () => {
    const periods = new Map<number, "future" | "open" | "closing" | "closed">();
    const planned = planFirstYearOpen(baseWorld({ periods }), 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.posts.every((post) => post.kind === "grant_lump" && post.leaveTypeId === sickId)).toBe(true);
    expect(planned.posts.some((post) => post.leaveTypeId === vacationId)).toBe(false);
    applyOpenPeriod(periods, 2026);
    expect(periods.get(2026)).toBe("open");
    expect(periods.get(2027)).toBe("future");
    expect(isPeriodOpen(periods.get(2026))).toBe(true);
  });

  it("refuses to open Y+1 while Y is already open", () => {
    const planned = planFirstYearOpen(baseWorld(), 2027);
    expect(planned.ok).toBe(false);
  });
});

describe("close unused is recomputed after closing is marked", () => {
  it("usage posted after the first plan reduces carry", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: 2000,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(ledger, new Map([[2026, "open"]]));
    const planned = executeCloseOnWorld(world, 2026, {}, {
      afterMarkClosing: (current) => {
        expect(current.periods.get(2026)).toBe("closing");
        ledger.post({
          employeeId,
          leaveTypeId: vacationId,
          kind: "usage",
          minutes: 480,
          effectiveOn: "2026-12-15",
          createdBy: actor,
        });
        current.ledger = ledger.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          minutes: row.minutes,
          effectiveOn: row.effectiveOn,
          periodYear: row.periodYear,
          reversedAt: row.reversedAt,
          employeeId: row.employeeId,
          leaveTypeId: row.leaveTypeId,
          reason: row.reason,
        }));
      },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const carry = planned.plan.posts.find((post) => post.kind === "carryover" && post.leaveTypeId === vacationId);
    expect(carry?.minutes).toBe(1520);
    expect(world.periods.get(2026)).toBe("closed");
  });
});

describe("reopen re-checks live activity before flipping periods", () => {
  it("refuses when accrual lands after the first plan and leaves Y+1 open", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "carryover",
      minutes: 480,
      effectiveOn: "2027-01-01",
      reason: "close:2026",
      createdBy: actor,
    });
    const world = worldFromLedger(
      ledger,
      new Map([
        [2026, "closed"],
        [2027, "open"],
      ]),
    );
    const result = executeReopenOnWorld(world, 2026, {
      afterPlan: (current) => {
        ledger.post({
          employeeId,
          leaveTypeId: vacationId,
          kind: "accrual",
          minutes: DEMO_VACATION_PERIODIC_MINUTES,
          effectiveOn: "2027-01-01",
          reason: "accrual:2027-01-01",
          createdBy: actor,
        });
        current.ledger = ledger.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          minutes: row.minutes,
          effectiveOn: row.effectiveOn,
          periodYear: row.periodYear,
          reversedAt: row.reversedAt,
          employeeId: row.employeeId,
          leaveTypeId: row.leaveTypeId,
          reason: row.reason,
        }));
      },
    });
    expect(result.ok).toBe(false);
    expect(world.periods.get(2026)).toBe("closed");
    expect(world.periods.get(2027)).toBe("open");
  });
});

describe("sick grant for Jan 1 Y+1 hires", () => {
  it("posts 1440 grant_lump tagged close:2026 for a 2027-01-01 hire", () => {
    const hireId = "66666666-6666-6666-6666-666666666666";
    const world = baseWorld({
      employees: [
        {
          id: hireId,
          name: "Bea",
          active: true,
          startDate: "2027-01-01",
          endDate: null,
        },
      ],
      assignments: [
        {
          employeeId: hireId,
          policyId: sickPolicyId,
          leaveTypeId: sickId,
          validFrom: "2027-01-01",
          validTo: null,
        },
      ],
    });
    const planned = planYearClose(world, 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const sick = planned.plan.posts.filter((post) => post.kind === "grant_lump" && post.leaveTypeId === sickId);
    expect(sick).toEqual([
      {
        employeeId: hireId,
        leaveTypeId: sickId,
        kind: "grant_lump",
        minutes: DEMO_SICK_GRANT_MINUTES,
        effectiveOn: "2027-01-01",
        reason: "close:2026",
      },
    ]);
  });
});

describe("close skips non-consuming types and inactive employees", () => {
  it("does not write carryover for WFH/unlimited", () => {
    const wfhId = "77777777-7777-7777-7777-777777777777";
    const wfhPolicyId = "88888888-8888-8888-8888-888888888888";
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: wfhId,
      kind: "adjustment",
      minutes: 480,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(ledger, new Map([[2026, "open"]]));
    world.leaveTypes = [...world.leaveTypes, { id: wfhId, code: "wfh", consumesBalance: false }];
    world.policies = [
      ...world.policies,
      {
        id: wfhPolicyId,
        leaveTypeId: wfhId,
        grantMode: "none",
        grantMinutes: null,
        periodicCadence: null,
        periodicMinutes: null,
        carryoverMaxMinutes: null,
        allowForfeit: false,
        accrualStopMinutes: null,
      },
    ];
    world.assignments = [
      ...world.assignments,
      {
        employeeId,
        policyId: wfhPolicyId,
        leaveTypeId: wfhId,
        validFrom: "2026-01-01",
        validTo: null,
      },
    ];
    const planned = planYearClose(world, 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.posts.some((post) => post.leaveTypeId === wfhId)).toBe(false);
    expect(planned.plan.preview.some((row) => row.leaveTypeId === wfhId)).toBe(false);
  });

  it("does not carry unused for an inactive employee", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: 2000,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(ledger, new Map([[2026, "open"]]));
    world.employees = world.employees.map((employee) => ({ ...employee, active: false }));
    const planned = planYearClose(world, 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.posts.filter((post) => post.kind === "carryover")).toHaveLength(0);
  });
});

describe("forfeit requires policy flag and acknowledgement", () => {
  it("posts no forfeit when allow_forfeit is true but ack is omitted", () => {
    const ledger = new MemoryLedger();
    ledger.post({
      employeeId,
      leaveTypeId: vacationId,
      kind: "accrual",
      minutes: 2000,
      effectiveOn: "2026-01-01",
      createdBy: actor,
    });
    const world = worldFromLedger(ledger, new Map([[2026, "open"]]));
    world.policies = world.policies.map((policy) =>
      policy.id === vacationPolicyId
        ? { ...policy, carryoverMaxMinutes: 480, allowForfeit: true }
        : policy,
    );
    const planned = planYearClose(world, 2026);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.posts.some((post) => post.kind === "forfeit")).toBe(false);
    expect(planned.plan.preview.find((row) => row.leaveTypeId === vacationId)?.forfeitMinutes).toBe(0);
  });
});

describe("parseCalendarYear", () => {
  it("rejects empty, scientific notation below 2000, and out of range", () => {
    expect(parseCalendarYear("")).toBeNull();
    expect(parseCalendarYear("1e3")).toBeNull();
    expect(parseCalendarYear(1999)).toBeNull();
    expect(parseCalendarYear("2026")).toBe(2026);
  });
});

describe("year_end_snapshots file", () => {
  it("writes a tmp file and returns sha256 + path", async () => {
    const written = await writeYearEndSnapshotFile("org-1", 2026, { year: 2026, carry: 480 });
    expect(written.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(written.path).toContain("aa-leave-year-end");
    const body = readFileSync(written.path, "utf8");
    expect(body).toContain('"carry": 480');
  });
});
