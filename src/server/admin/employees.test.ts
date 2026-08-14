import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "@/server/audit";
import type { LedgerRow, PostLedgerInput } from "@/server/ledger/post";
import {
  assignEmployeePolicy,
  buildRosterRows,
  parseAdjustInput,
  parseAssignPolicyInput,
  postAdjustment,
  withRunningRemaining,
  type EmployeeStore,
  type FileAssignment,
} from "./employees";

const VACATION = "11111111-1111-4111-8111-111111111111";
const SICK = "22222222-2222-4222-8222-222222222222";
const POLICY = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";

function store(overrides: Partial<EmployeeStore> = {}): EmployeeStore {
  const unused = async () => {
    throw new Error("unused store method");
  };
  return {
    loadOrg: unused as EmployeeStore["loadOrg"],
    listPeople: unused as EmployeeStore["listPeople"],
    findVacationTypeId: unused as EmployeeStore["findVacationTypeId"],
    loadVacationLedger: unused as EmployeeStore["loadVacationLedger"],
    loadVacationPending: unused as EmployeeStore["loadVacationPending"],
    loadLastEntryDates: unused as EmployeeStore["loadLastEntryDates"],
    getEmployee: async () => ({
      id: PERSON,
      orgId: "org-1",
      name: "Ada",
      email: "ada@example.com",
      role: "employee",
      managerId: null,
      startDate: "2026-01-15",
      endDate: null,
      employmentType: "full_time",
      workdayMinutes: 480,
      orgWorkdayMinutes: 480,
      timezone: "UTC",
      active: true,
    }),
    listLeaveTypes: unused as EmployeeStore["listLeaveTypes"],
    loadEmployeeLedger: unused as EmployeeStore["loadEmployeeLedger"],
    loadEmployeeEntries: unused as EmployeeStore["loadEmployeeEntries"],
    loadAssignments: unused as EmployeeStore["loadAssignments"],
    listPolicies: unused as EmployeeStore["listPolicies"],
    loadTypeLedger: unused as EmployeeStore["loadTypeLedger"],
    loadTypePending: unused as EmployeeStore["loadTypePending"],
    leaveTypeInOrg: async () => true,
    periodStatus: async () => "open",
    postAdjustment: unused as EmployeeStore["postAdjustment"],
    getPolicyRef: async () => ({ id: POLICY, leaveTypeId: VACATION }),
    upsertAssignment: unused as EmployeeStore["upsertAssignment"],
    countPending: unused as EmployeeStore["countPending"],
    listPending: unused as EmployeeStore["listPending"],
    findLeaveEntryInOrg: unused as EmployeeStore["findLeaveEntryInOrg"],
    isAppReadonly: async () => false,
    ...overrides,
  };
}

describe("parseAdjustInput", () => {
  it("requires a non-empty reason", () => {
    expect(
      parseAdjustInput({
        leaveTypeId: VACATION,
        minutes: 60,
        effectiveOn: "2026-03-01",
        reason: "  ",
      }),
    ).toEqual({ ok: false, error: "reason is required" });
  });

  it("rejects impossible calendar dates", () => {
    expect(
      parseAdjustInput({
        leaveTypeId: VACATION,
        minutes: 60,
        effectiveOn: "2026-02-31",
        reason: "correction",
      }),
    ).toEqual({ ok: false, error: "effectiveOn must be YYYY-MM-DD" });
  });

  it("accepts signed hours at the boundary", () => {
    expect(
      parseAdjustInput({
        leaveTypeId: VACATION,
        hours: "-2.5",
        effectiveOn: "2026-03-01",
        reason: "correction",
      }),
    ).toEqual({
      ok: true,
      value: {
        leaveTypeId: VACATION,
        minutes: -150,
        effectiveOn: "2026-03-01",
        reason: "correction",
      },
    });
  });
});

describe("parseAssignPolicyInput", () => {
  it("rejects validTo before validFrom", () => {
    expect(
      parseAssignPolicyInput({
        policyId: POLICY,
        validFrom: "2026-06-01",
        validTo: "2026-01-01",
      }),
    ).toEqual({ ok: false, error: "validTo must be on or after validFrom" });
  });
});

describe("buildRosterRows", () => {
  it("computes remaining vacation hours from live ledger SUM", () => {
    const rows = buildRosterRows({
      people: [
        {
          id: PERSON,
          name: "Ada",
          email: "ada@example.com",
          role: "employee",
          employmentType: "full_time",
          active: true,
          startDate: "2026-01-15",
        },
      ],
      vacationTypeId: VACATION,
      ledger: [
        {
          kind: "accrual",
          minutes: 680,
          effectiveOn: "2026-02-01",
          periodYear: 2026,
          reversedAt: null,
          employeeId: PERSON,
          leaveTypeId: VACATION,
        },
        {
          kind: "usage",
          minutes: -120,
          effectiveOn: "2026-02-10",
          periodYear: 2026,
          reversedAt: null,
          employeeId: PERSON,
          leaveTypeId: VACATION,
        },
      ],
      pending: [],
      lastEntryByEmployee: new Map([[PERSON, "2026-02-10"]]),
      asOf: "2026-03-01",
      timeZone: "UTC",
    });
    expect(rows[0]?.remainingVacationMinutes).toBe(560);
    expect(rows[0]?.remainingVacationHours).toBe("9.33");
    expect(rows[0]?.lastEntryDate).toBe("2026-02-10");
  });
});

describe("withRunningRemaining", () => {
  it("walks live rows in date order per leave type", () => {
    const lines = withRunningRemaining([
      {
        id: "2",
        leaveTypeId: VACATION,
        leaveTypeCode: "vacation_unpaid",
        kind: "usage",
        minutes: -60,
        effectiveOn: "2026-02-02",
        periodYear: 2026,
        reason: null,
        reversedAt: null,
      },
      {
        id: "1",
        leaveTypeId: VACATION,
        leaveTypeCode: "vacation_unpaid",
        kind: "accrual",
        minutes: 680,
        effectiveOn: "2026-02-01",
        periodYear: 2026,
        reason: null,
        reversedAt: null,
      },
    ]);
    expect(lines[0]?.runningRemainingMinutes).toBe(620);
    expect(lines[1]?.runningRemainingMinutes).toBe(680);
  });
});

describe("postAdjustment", () => {
  it("is admin-only and never posts without a reason", async () => {
    const posted: PostLedgerInput[] = [];
    const events: AuditEventInput[] = [];
    const deps = {
      store: store({
        postAdjustment: async (input) => {
          posted.push(input);
          return { id: "led-1", minutes: input.minutes } as LedgerRow;
        },
      }),
      writeAudit: async (event: AuditEventInput) => {
        events.push(event);
      },
    };

    const forbidden = await postAdjustment({
      actor: { id: "alice", role: "employee" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { leaveTypeId: VACATION, minutes: 60, effectiveOn: "2026-03-01", reason: "oops" },
      ...deps,
    });
    expect(forbidden).toEqual({ ok: false, status: 403, error: "forbidden" });
    expect(posted).toEqual([]);

    const missing = await postAdjustment({
      actor: { id: "admin", role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { leaveTypeId: VACATION, minutes: 60, effectiveOn: "2026-03-01" },
      ...deps,
    });
    expect(missing).toEqual({ ok: false, status: 400, error: "reason is required" });
    expect(posted).toEqual([]);

    const ok = await postAdjustment({
      actor: { id: "admin", role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: {
        leaveTypeId: VACATION,
        minutes: -90,
        effectiveOn: "2026-03-01",
        reason: "sheet correction",
      },
      ...deps,
    });
    expect(ok.ok).toBe(true);
    expect(posted).toEqual([
      expect.objectContaining({
        kind: "adjustment",
        minutes: -90,
        reason: "sheet correction",
        createdBy: "admin",
      }),
    ]);
    expect(events[0]?.action).toBe("ledger.adjust");
  });

  it("404s a non-uuid employee id without posting", async () => {
    const result = await postAdjustment({
      actor: { id: "admin", role: "admin" },
      orgId: "org-1",
      employeeId: "not-a-uuid",
      raw: { leaveTypeId: VACATION, minutes: 60, effectiveOn: "2026-03-01", reason: "fix" },
      store: store({
        postAdjustment: async () => {
          throw new Error("must not post");
        },
      }),
      writeAudit: async () => undefined,
    });
    expect(result).toEqual({ ok: false, status: 404, error: "employee not found" });
  });

  it("returns 423 when the app is readonly", async () => {
    const result = await postAdjustment({
      actor: { id: "admin", role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { leaveTypeId: VACATION, minutes: 60, effectiveOn: "2026-03-01", reason: "fix" },
      store: store({
        isAppReadonly: async () => true,
        postAdjustment: async () => {
          throw new Error("must not post");
        },
      }),
      writeAudit: async () => undefined,
    });
    expect(result).toEqual({
      ok: false,
      status: 423,
      error: "The application is in read-only mode.",
    });
  });
});

describe("assignEmployeePolicy", () => {
  it("upserts one assignment per employee+type", async () => {
    const assignment: FileAssignment = {
      id: "as-1",
      policyId: POLICY,
      policyName: "Vacation",
      leaveTypeId: VACATION,
      leaveTypeCode: "vacation_unpaid",
      validFrom: "2026-01-01",
      validTo: null,
    };
    const result = await assignEmployeePolicy({
      actor: { id: "admin", role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { policyId: POLICY, validFrom: "2026-01-01" },
      store: store({
        upsertAssignment: async (row) => {
          expect(row.leaveTypeId).toBe(VACATION);
          expect(row.leaveTypeId).not.toBe(SICK);
          return assignment;
        },
      }),
      writeAudit: async () => undefined,
    });
    expect(result).toEqual({ ok: true, assignment });
  });
});
