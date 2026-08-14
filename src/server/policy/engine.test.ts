import { describe, expect, it } from "vitest";
import {
  DEMO_MIN_INCREMENT_MINUTES,
  DEMO_VACATION_TAKE_CEILING_MINUTES,
  DEMO_WORKDAY_MINUTES,
} from "@/db/demo-policy";
import { evaluateLeave } from "./engine";
import type {
  EvaluateLeaveInput,
  ExistingLeave,
  PolicyBalance,
  PolicyEmployee,
  PolicySnapshot,
  Portion,
  ProposedLeave,
} from "./types";

const MON = "2026-07-06";
const TUE = "2026-07-07";
const WED = "2026-07-08";
const TODAY = "2026-06-01";

const employee: PolicyEmployee = { startDate: "2020-01-01", workdayMinutes: DEMO_WORKDAY_MINUTES };

const openRoom: PolicyBalance = {
  takenMinutes: 0,
  scheduledMinutes: 0,
  requestedMinutes: 0,
  availableMinutes: 20_000,
};

const openPolicy: PolicySnapshot = {
  takeCeilingMinutes: null,
  minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
  negativeAllowed: true,
  waitingPeriodDays: 0,
  approvalForLog: "none",
  approvalForRequest: "admin",
  consumesBalance: true,
};

function dayEntry(
  portion: Portion,
  extras: Partial<ProposedLeave> = {},
): ProposedLeave {
  return {
    startDate: MON,
    endDate: MON,
    portion,
    consumesBalance: true,
    customMinutes: portion === "custom" ? 180 : null,
    ...extras,
  };
}

function existingDay(
  portion: Portion,
  extras: Partial<ExistingLeave> = {},
): ExistingLeave {
  return {
    startDate: MON,
    endDate: MON,
    portion,
    consumesBalance: true,
    status: "approved",
    customMinutes: portion === "custom" ? 180 : null,
    ...extras,
  };
}

function evaluate(partial: Partial<EvaluateLeaveInput> & { entry: ProposedLeave }): ReturnType<
  typeof evaluateLeave
> {
  return evaluateLeave({
    employee,
    policy: openPolicy,
    balance: openRoom,
    holidays: [],
    existing: [],
    today: TODAY,
    periodStatuses: [{ year: 2026, status: "open" }],
    ...partial,
  });
}

describe("overlap fixtures", () => {
  it.each([
    {
      name: "Vacation full Mon + Vacation full Mon",
      existing: existingDay("full"),
      entry: dayEntry("full"),
      ok: false,
    },
    {
      name: "Vacation am Mon + Sick pm Mon",
      existing: existingDay("am"),
      entry: dayEntry("pm"),
      ok: true,
    },
    {
      name: "Vacation am Mon + Sick am Mon",
      existing: existingDay("am"),
      entry: dayEntry("am"),
      ok: false,
    },
    {
      name: "Vacation full Mon + WFH full Mon",
      existing: existingDay("full"),
      entry: dayEntry("full", { consumesBalance: false }),
      ok: true,
    },
    {
      name: "Vacation custom 3h Mon + Sick am Mon",
      existing: existingDay("custom", { customMinutes: 180 }),
      entry: dayEntry("am"),
      ok: false,
    },
  ] satisfies {
    name: string;
    existing: ExistingLeave;
    entry: ProposedLeave;
    ok: boolean;
  }[])("$name", ({ existing, entry, ok }) => {
    const result = evaluate({ existing: [existing], entry });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("overlap");
    }
    if (ok && result.ok === true) {
      expect(result.minutes).toBeGreaterThan(0);
    }
  });

  it("does not treat cancelled or inactive days as occupying", () => {
    const result = evaluate({
      existing: [
        existingDay("full", { status: "cancelled" }),
        existingDay("full", { status: "approved", slotActive: false }),
      ],
      entry: dayEntry("full"),
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("take_ceiling", () => {
  it.each([
    {
      name: "rejects when taken+scheduled+requested+this exceeds ceiling",
      balance: { takenMinutes: 8000, scheduledMinutes: 0, requestedMinutes: 0, availableMinutes: 160 },
      ceiling: DEMO_VACATION_TAKE_CEILING_MINUTES,
      ok: false,
    },
    {
      name: "allows when the sum equals the ceiling",
      balance: { takenMinutes: 7680, scheduledMinutes: 0, requestedMinutes: 0, availableMinutes: 480 },
      ceiling: DEMO_VACATION_TAKE_CEILING_MINUTES,
      ok: true,
    },
    {
      name: "skips when take_ceiling_minutes is null",
      balance: { takenMinutes: 9000, scheduledMinutes: 0, requestedMinutes: 0, availableMinutes: 480 },
      ceiling: null,
      ok: true,
    },
  ])("$name", ({ balance, ceiling, ok }) => {
    const result = evaluate({
      entry: dayEntry("full"),
      balance,
      policy: { ...openPolicy, takeCeilingMinutes: ceiling, negativeAllowed: true },
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("take_ceiling");
    }
  });
});

describe("min_increment", () => {
  it.each([
    { name: "full day 480 % 60", portion: "full" as const, customMinutes: null, increment: 60, ok: true },
    { name: "custom 180 % 60", portion: "custom" as const, customMinutes: 180, increment: 60, ok: true },
    { name: "custom 90 not multiple of 60", portion: "custom" as const, customMinutes: 90, increment: 60, ok: false },
    { name: "am 240 not multiple of 480", portion: "am" as const, customMinutes: null, increment: 480, ok: false },
  ])("$name", ({ portion, customMinutes, increment, ok }) => {
    const result = evaluate({
      entry: dayEntry(portion, { customMinutes }),
      policy: { ...openPolicy, minIncrementMinutes: increment },
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("min_increment");
    }
  });
});

describe("negative_balance", () => {
  it.each([
    {
      name: "rejects when not allowed and available - this < 0",
      availableMinutes: 240,
      endDate: MON,
      negativeAllowed: false,
      negativeFloorMinutes: null,
      ok: false,
    },
    {
      name: "allows when available equals this and floor is 0",
      availableMinutes: 480,
      endDate: MON,
      negativeAllowed: false,
      negativeFloorMinutes: null,
      ok: true,
    },
    {
      name: "allows going negative when allowed and no floor",
      availableMinutes: 0,
      endDate: MON,
      negativeAllowed: true,
      negativeFloorMinutes: null,
      ok: true,
    },
    {
      name: "rejects when allowed but projected is below floor",
      availableMinutes: 480,
      endDate: TUE,
      negativeAllowed: true,
      negativeFloorMinutes: -240,
      ok: false,
    },
  ])("$name", ({ availableMinutes, endDate, negativeAllowed, negativeFloorMinutes, ok }) => {
    const result = evaluate({
      entry: { startDate: MON, endDate, portion: "full", consumesBalance: true },
      balance: {
        takenMinutes: 0,
        scheduledMinutes: 0,
        requestedMinutes: 0,
        availableMinutes,
      },
      policy: {
        ...openPolicy,
        takeCeilingMinutes: null,
        negativeAllowed,
        negativeFloorMinutes,
      },
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("negative_balance");
    }
  });

  it("the first row of this table is a 960-minute take against 480 available", () => {
    const result = evaluate({
      entry: { startDate: MON, endDate: TUE, portion: "full", consumesBalance: true },
      balance: {
        takenMinutes: 0,
        scheduledMinutes: 0,
        requestedMinutes: 0,
        availableMinutes: 480,
      },
      policy: { ...openPolicy, takeCeilingMinutes: null, negativeAllowed: false },
    });
    expect(result).toMatchObject({ ok: false, code: "negative_balance" });
  });
});

describe("holidays_excluded", () => {
  it.each([
    {
      name: "skips a mid-week holiday for consuming leave",
      consumesBalance: true,
      holidays: [{ onDate: TUE }],
      expectedMinutes: DEMO_WORKDAY_MINUTES * 2,
    },
    {
      name: "keeps holiday dates for non-consuming leave",
      consumesBalance: false,
      holidays: [{ onDate: TUE }],
      expectedMinutes: DEMO_WORKDAY_MINUTES * 3,
    },
    {
      name: "charges every weekday when the holiday table is empty",
      consumesBalance: true,
      holidays: [],
      expectedMinutes: DEMO_WORKDAY_MINUTES * 3,
    },
  ])("$name", ({ consumesBalance, holidays, expectedMinutes }) => {
    const result = evaluate({
      entry: {
        startDate: MON,
        endDate: WED,
        portion: "full",
        consumesBalance,
      },
      holidays,
      policy: { ...openPolicy, consumesBalance },
    });
    expect(result).toMatchObject({ ok: true, minutes: expectedMinutes });
  });
});

describe("waiting_period", () => {
  it.each([
    {
      name: "rejects consuming leave before hire + N days",
      startDate: "2026-03-31",
      waitingPeriodDays: 90,
      override: false,
      ok: false,
    },
    {
      name: "allows the first eligible day",
      startDate: "2026-04-01",
      waitingPeriodDays: 90,
      override: false,
      ok: true,
    },
    {
      name: "admin override skips the wait",
      startDate: "2026-03-31",
      waitingPeriodDays: 90,
      override: true,
      ok: true,
    },
  ])("$name", ({ startDate, waitingPeriodDays, override, ok }) => {
    const result = evaluate({
      employee: { startDate: "2026-01-01", workdayMinutes: DEMO_WORKDAY_MINUTES },
      entry: { startDate, endDate: startDate, portion: "full", consumesBalance: true },
      policy: { ...openPolicy, waitingPeriodDays },
      override,
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("waiting_period");
    }
  });
});

describe("closed_period", () => {
  it.each([
    {
      name: "rejects a day in a closed year",
      startDate: "2025-06-02",
      endDate: "2025-06-02",
      periodStatuses: [
        { year: 2025, status: "closed" },
        { year: 2026, status: "open" },
      ],
      ok: false,
    },
    {
      name: "allows a day in an open year",
      startDate: MON,
      endDate: MON,
      periodStatuses: [{ year: 2026, status: "open" }],
      ok: true,
    },
    {
      name: "rejects a span that touches a closed year",
      startDate: "2025-12-31",
      endDate: "2026-01-02",
      periodStatuses: [
        { year: 2025, status: "closed" },
        { year: 2026, status: "open" },
      ],
      ok: false,
    },
  ])("$name", ({ startDate, endDate, periodStatuses, ok }) => {
    const result = evaluate({
      entry: { startDate, endDate, portion: "full", consumesBalance: true },
      periodStatuses,
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("closed_period");
    }
  });
});

describe("span_crosses_today", () => {
  it.each([
    {
      name: "rejects start < today < end",
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      today: "2026-07-06",
      ok: false,
    },
    {
      name: "allows a range that starts today",
      startDate: "2026-07-06",
      endDate: "2026-07-10",
      today: "2026-07-06",
      ok: true,
    },
    {
      name: "allows a range that ends today",
      startDate: "2026-07-01",
      endDate: "2026-07-06",
      today: "2026-07-06",
      ok: true,
    },
  ])("$name", ({ startDate, endDate, today, ok }) => {
    const result = evaluate({
      entry: { startDate, endDate, portion: "full", consumesBalance: true },
      today,
    });
    expect(result.ok).toBe(ok);
    if (!ok && result.ok === false) {
      expect(result.code).toBe("span_crosses_today");
    }
  });
});

describe("approval and follow-on", () => {
  it("auto-approves a past log when approval_for_log is none and posts the ledger", () => {
    const result = evaluate({
      entry: { startDate: "2026-05-04", endDate: "2026-05-04", portion: "full", consumesBalance: true },
      today: TODAY,
    });
    expect(result).toEqual({
      ok: true,
      minutes: DEMO_WORKDAY_MINUTES,
      postsLedger: true,
      newStatus: "approved",
    });
  });

  it("keeps a future request pending when approval_for_request is admin", () => {
    const result = evaluate({
      entry: dayEntry("full"),
      today: TODAY,
    });
    expect(result).toEqual({
      ok: true,
      minutes: DEMO_WORKDAY_MINUTES,
      postsLedger: false,
      newStatus: "pending",
    });
  });

  it("ignores follow-on rule codes even when enabled", () => {
    const result = evaluate({
      entry: dayEntry("full"),
      policy: {
        ...openPolicy,
        rules: [
          { code: "notice_period", enabled: true, params: { days: 14 } },
          { code: "blackout", enabled: false },
          { code: "annual_hour_cap", enabled: true },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });
});
