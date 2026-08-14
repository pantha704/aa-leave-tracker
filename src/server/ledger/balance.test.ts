import { describe, expect, it } from "vitest";
import { DEMO_VACATION_GRANT_MINUTES, DEMO_VACATION_PERIODIC_MINUTES } from "@/db/demo-policy";
import {
  computeBalance,
  isLiveLedgerRow,
  pendingMinutesInPeriod,
  periodYearFromAsOf,
  type Balance,
} from "./balance";
import { MemoryLedger, type MemoryBalanceScope } from "./memory";
import { signedLedgerMinutes } from "./post";

const TZ = "UTC";
const JAN = "2026-01-01";
const FEB = "2026-02-01";
const JULY_WEEK = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"] as const;

function liveForfeitMinutes(ledger: MemoryLedger, scope: MemoryBalanceScope, periodYear: number): number {
  return ledger.rows
    .filter(
      (row) =>
        row.employeeId === scope.employeeId &&
        row.leaveTypeId === scope.leaveTypeId &&
        row.periodYear === periodYear &&
        row.reversedAt == null &&
        row.kind === "forfeit",
    )
    .reduce((sum, row) => sum + row.minutes, 0);
}

function expectRemainingIsLiveSum(balance: Balance, forfeitMinutes = 0) {
  expect(balance.remainingMinutes).toBe(
    balance.grantedMinutes - balance.takenMinutes - balance.scheduledMinutes + forfeitMinutes,
  );
}

function seedJanFebAccrual(ledger: MemoryLedger) {
  const actor = crypto.randomUUID();
  const employeeId = crypto.randomUUID();
  const leaveTypeId = crypto.randomUUID();
  for (const effectiveOn of [JAN, FEB]) {
    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "accrual",
      minutes: DEMO_VACATION_PERIODIC_MINUTES,
      effectiveOn,
      createdBy: actor,
    });
  }
  return { actor, employeeId, leaveTypeId, scope: { employeeId, leaveTypeId, timeZone: TZ } };
}

describe("period year in org timezone", () => {
  it("uses the calendar date when asOf is already YYYY-MM-DD", () => {
    expect(periodYearFromAsOf("2026-12-31", "Pacific/Auckland")).toBe(2026);
  });

  it("converts Date instants with the org zone (no host default)", () => {
    const nyeUtc = new Date("2026-12-31T22:00:00.000Z");
    expect(periodYearFromAsOf(nyeUtc, "UTC")).toBe(2026);
    expect(periodYearFromAsOf(nyeUtc, "Pacific/Auckland")).toBe(2027);
  });

  it("keeps asOf as an org-local civil date so west-of-UTC zones do not shift year", () => {
    const first = computeBalance({
      rows: [],
      pendingEntries: [],
      asOf: "2026-01-01",
      timeZone: "America/Los_Angeles",
    });
    expect(first.asOf).toBe("2026-01-01");
    const again = computeBalance({
      rows: [],
      pendingEntries: [],
      asOf: first.asOf,
      timeZone: "America/Los_Angeles",
    });
    expect(again.asOf).toBe("2026-01-01");
    expect(periodYearFromAsOf(again.asOf, "America/Los_Angeles")).toBe(2026);
  });
});

describe("signed usage minutes", () => {
  it("stores usage as a debit so remaining can be a SUM", () => {
    expect(signedLedgerMinutes("usage", 480)).toBe(-480);
    expect(signedLedgerMinutes("usage", -480)).toBe(-480);
    expect(signedLedgerMinutes("accrual", 680)).toBe(680);
    expect(signedLedgerMinutes("adjustment", -480)).toBe(-480);
  });

  it("rejects non-integer minutes", () => {
    expect(() => signedLedgerMinutes("usage", 60.5)).toThrow(/integer/);
  });
});

describe("pending minutes split by period year", () => {
  it("does not charge the full total_minutes to both years of a year-end span", () => {
    const entry = {
      status: "pending" as const,
      totalMinutes: 1920,
      startDate: "2026-12-30",
      endDate: "2027-01-02",
    };
    expect(pendingMinutesInPeriod(entry, 2026)).toBe(960);
    expect(pendingMinutesInPeriod(entry, 2027)).toBe(960);
  });

  it("uses explicit per-day minutes when provided", () => {
    const entry = {
      status: "pending" as const,
      totalMinutes: 1440,
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      days: [
        { onDate: "2026-12-31", minutes: 480 },
        { onDate: "2027-01-01", minutes: 960 },
      ],
    };
    expect(pendingMinutesInPeriod(entry, 2026)).toBe(480);
    expect(pendingMinutesInPeriod(entry, 2027)).toBe(960);
  });
});

describe("fixture (a) July week requested in March", () => {
  it("keeps remaining as one SUM; July asOf vs December only flips taken/scheduled", () => {
    const ledger = new MemoryLedger();
    const { actor, employeeId, leaveTypeId, scope } = seedJanFebAccrual(ledger);

    ledger.pending = [
      {
        status: "pending",
        totalMinutes: 2400,
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        employeeId,
        leaveTypeId,
      },
    ];

    const beforeApprove = ledger.balance("2026-03-15", scope);
    expect(beforeApprove.grantedMinutes).toBe(1360);
    expect(beforeApprove.takenMinutes).toBe(0);
    expect(beforeApprove.scheduledMinutes).toBe(0);
    expect(beforeApprove.requestedMinutes).toBe(2400);
    expect(beforeApprove.remainingMinutes).toBe(1360);
    expect(beforeApprove.availableMinutes).toBe(1360 - 2400);
    expect(beforeApprove.asOf).toBe("2026-03-15");
    expectRemainingIsLiveSum(beforeApprove);

    ledger.pending = [];
    for (const day of JULY_WEEK) {
      ledger.post({
        employeeId,
        leaveTypeId,
        kind: "usage",
        minutes: 480,
        effectiveOn: day,
        createdBy: actor,
      });
    }

    const march = ledger.balance("2026-03-15", scope);
    expect(march.grantedMinutes).toBe(1360);
    expect(march.takenMinutes).toBe(0);
    expect(march.scheduledMinutes).toBe(2400);
    expect(march.requestedMinutes).toBe(0);
    expect(march.remainingMinutes).toBe(-1040);
    expectRemainingIsLiveSum(march);

    const july = ledger.balance("2026-07-10", scope);
    expect(july.grantedMinutes).toBe(1360);
    expect(july.takenMinutes).toBe(2400);
    expect(july.scheduledMinutes).toBe(0);
    expect(july.remainingMinutes).toBe(-1040);
    expectRemainingIsLiveSum(july);

    const december = ledger.balance("2026-12-31", scope);
    expect(december.remainingMinutes).toBe(july.remainingMinutes);
    expect(december.takenMinutes).toBe(2400);
    expect(december.scheduledMinutes).toBe(0);
    expectRemainingIsLiveSum(december);
  });

  it("re-runs (a) with an 8h July take: scheduled=480 remaining=880", () => {
    const ledger = new MemoryLedger();
    const { actor, employeeId, leaveTypeId, scope } = seedJanFebAccrual(ledger);
    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: actor,
    });

    const march = ledger.balance("2026-03-15", scope);
    expect(march.grantedMinutes).toBe(1360);
    expect(march.takenMinutes).toBe(0);
    expect(march.scheduledMinutes).toBe(480);
    expect(march.remainingMinutes).toBe(880);
    expectRemainingIsLiveSum(march);

    const july = ledger.balance("2026-07-06", scope);
    expect(july.takenMinutes).toBe(480);
    expect(july.scheduledMinutes).toBe(0);
    expect(july.remainingMinutes).toBe(880);

    const december = ledger.balance("2026-12-15", scope);
    expect(december.remainingMinutes).toBe(880);
    expect(december.takenMinutes).toBe(480);
  });
});

describe("fixture (b) year-end while next January already has approved usage", () => {
  it("posts carryover only; Jan 5 usage is period_year 2027", () => {
    const ledger = new MemoryLedger();
    const actor = crypto.randomUUID();
    const employeeId = crypto.randomUUID();
    const leaveTypeId = crypto.randomUUID();
    const scope = { employeeId, leaveTypeId, timeZone: TZ };

    for (let month = 1; month <= 12; month++) {
      ledger.post({
        employeeId,
        leaveTypeId,
        kind: "accrual",
        minutes: DEMO_VACATION_PERIODIC_MINUTES,
        effectiveOn: `2026-${String(month).padStart(2, "0")}-01`,
        createdBy: actor,
      });
    }

    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2027-01-05",
      periodYear: 2027,
      createdBy: actor,
    });

    const dec = ledger.balance("2026-12-15", scope);
    expect(dec.grantedMinutes).toBe(DEMO_VACATION_GRANT_MINUTES);
    expect(dec.takenMinutes).toBe(0);
    expect(dec.scheduledMinutes).toBe(0);
    expect(dec.remainingMinutes).toBe(DEMO_VACATION_GRANT_MINUTES);
    expectRemainingIsLiveSum(dec);

    const unused2026 = dec.remainingMinutes;
    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "carryover",
      minutes: unused2026,
      effectiveOn: "2027-01-01",
      periodYear: 2027,
      reason: "close:2026",
      createdBy: actor,
    });

    expect(ledger.rows.some((row) => row.kind === "grant_lump" && row.periodYear === 2027)).toBe(
      false,
    );
    expect(ledger.rows.filter((row) => row.kind === "usage" && row.periodYear === 2027)).toHaveLength(
      1,
    );
    expect(ledger.rows.find((row) => row.kind === "usage")?.minutes).toBe(-480);

    const jan1 = ledger.balance("2027-01-01", scope);
    expect(jan1.grantedMinutes).toBe(unused2026);
    expect(jan1.takenMinutes).toBe(0);
    expect(jan1.scheduledMinutes).toBe(480);
    expect(jan1.remainingMinutes).toBe(unused2026 - 480);
    expectRemainingIsLiveSum(jan1);

    const jan5 = ledger.balance("2027-01-05", scope);
    expect(jan5.takenMinutes).toBe(480);
    expect(jan5.scheduledMinutes).toBe(0);
    expect(jan5.remainingMinutes).toBe(unused2026 - 480);
    expectRemainingIsLiveSum(jan5);
  });
});

describe("live filter", () => {
  it("drops reversed originals and reversal rows from the SUM", () => {
    expect(isLiveLedgerRow({ reversedAt: null, kind: "accrual" })).toBe(true);
    expect(isLiveLedgerRow({ reversedAt: new Date(), kind: "accrual" })).toBe(false);
    expect(isLiveLedgerRow({ reversedAt: null, kind: "reversal" })).toBe(false);
  });

  it("a negative adjustment lowers granted and remaining", () => {
    const ledger = new MemoryLedger();
    const ids = seedJanFebAccrual(ledger);
    ledger.post({
      employeeId: ids.employeeId,
      leaveTypeId: ids.leaveTypeId,
      kind: "adjustment",
      minutes: -480,
      effectiveOn: "2026-03-01",
      createdBy: ids.actor,
      reason: "correction",
    });
    const bal = ledger.balance("2026-03-15", ids.scope);
    expect(bal.grantedMinutes).toBe(880);
    expect(bal.remainingMinutes).toBe(880);
  });

  it("includes live forfeit in remaining SUM but not granted/taken/scheduled", () => {
    const ledger = new MemoryLedger();
    const { actor, employeeId, leaveTypeId, scope } = seedJanFebAccrual(ledger);
    ledger.post({
      employeeId,
      leaveTypeId,
      kind: "forfeit",
      minutes: 200,
      effectiveOn: "2026-12-31",
      createdBy: actor,
    });
    const bal = ledger.balance("2026-12-31", scope);
    expect(bal.grantedMinutes).toBe(1360);
    expect(bal.takenMinutes).toBe(0);
    expect(bal.scheduledMinutes).toBe(0);
    expect(bal.remainingMinutes).toBe(1160);
    expectRemainingIsLiveSum(bal, liveForfeitMinutes(ledger, scope, 2026));
  });

  it("does not merge two employee banks in the in-memory helper", () => {
    const ledger = new MemoryLedger();
    const actor = crypto.randomUUID();
    const leaveTypeId = crypto.randomUUID();
    const alice = crypto.randomUUID();
    const bob = crypto.randomUUID();
    ledger.post({
      employeeId: alice,
      leaveTypeId,
      kind: "accrual",
      minutes: 680,
      effectiveOn: JAN,
      createdBy: actor,
    });
    ledger.post({
      employeeId: bob,
      leaveTypeId,
      kind: "accrual",
      minutes: 480,
      effectiveOn: JAN,
      createdBy: actor,
    });
    expect(ledger.balance(JAN, { employeeId: alice, leaveTypeId }).remainingMinutes).toBe(680);
    expect(ledger.balance(JAN, { employeeId: bob, leaveTypeId }).remainingMinutes).toBe(480);
  });
});
