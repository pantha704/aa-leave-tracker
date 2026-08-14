import { describe, expect, it } from "vitest";
import {
  assignPolicy,
  createPolicy,
  parseAssignmentInput,
  parsePolicyInput,
  parsePolicyJson,
  policyInputFromFormData,
  updatePolicy,
  type PolicyPersistence,
  type PolicyRecord,
  type PolicySaveInput,
  type AssignmentRecord,
} from "./save";

const LEAVE_TYPE_ID = "11111111-1111-1111-1111-111111111111";

function validPolicy(overrides: Record<string, unknown> = {}) {
  return {
    leave_type_id: LEAVE_TYPE_ID,
    name: "Vacation / Unpaid 17d monthly",
    grant_mode: "periodic",
    grant_minutes: 8160,
    periodic_cadence: "monthly",
    periodic_minutes: 680,
    take_ceiling_minutes: 8160,
    effective_from: "2026-01-01",
    ...overrides,
  };
}

describe("parsePolicyInput", () => {
  it("rejects missing leave_type_id", () => {
    const { leave_type_id: _omit, ...rest } = validPolicy();
    void _omit;
    const parsed = parsePolicyInput(rest);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/leave_type_id/);
    }
  });

  it("maps take_ceiling to take_ceiling_minutes and rejects a non-integer", () => {
    const { take_ceiling_minutes: _omitCeiling, ...withoutCeiling } = validPolicy();
    void _omitCeiling;

    const fromAlias = parsePolicyInput({ ...withoutCeiling, take_ceiling: 8160 });
    expect(fromAlias).toEqual({
      ok: true,
      value: expect.objectContaining({ take_ceiling_minutes: 8160 }),
    });

    const fromMinutes = parsePolicyInput(validPolicy({ take_ceiling_minutes: 8160 }));
    expect(fromMinutes.ok).toBe(true);
    if (fromMinutes.ok) {
      expect(fromMinutes.value.take_ceiling_minutes).toBe(8160);
    }

    const omitted = parsePolicyInput(withoutCeiling);
    expect(omitted.ok).toBe(true);
    if (omitted.ok) {
      expect(omitted.value.take_ceiling_minutes).toBeUndefined();
    }

    const fractional = parsePolicyInput({ ...withoutCeiling, take_ceiling: 12.5 });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) {
      expect(fractional.error).toMatch(/take_ceiling/);
    }
  });

  it("defaults allow_forfeit to false", () => {
    const parsed = parsePolicyInput(validPolicy());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.allow_forfeit).toBe(false);
    }

    const explicit = parsePolicyInput(validPolicy({ allow_forfeit: true }));
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.value.allow_forfeit).toBe(true);
    }
  });

  it("accepts tenure bands in the same payload", () => {
    const parsed = parsePolicyInput(
      validPolicy({
        tenure_bands: [{ min_years: 0, max_years: 5, grant_minutes: 8160 }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.tenure_bands).toEqual([
        { min_years: 0, max_years: 5, grant_minutes: 8160 },
      ]);
    }
  });
});

describe("parsePolicyJson", () => {
  it("rejects invalid JSON", () => {
    expect(parsePolicyJson("{")).toEqual({ ok: false, error: "invalid JSON" });
  });
});

describe("policyInputFromFormData", () => {
  function form(entries: Record<string, string | string[]>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) {
      if (Array.isArray(value)) {
        for (const item of value) data.append(key, item);
      } else {
        data.set(key, value);
      }
    }
    return data;
  }

  it("maps grant, caps, approval flags, and tenure bands", () => {
    const parsed = policyInputFromFormData(
      form({
        leave_type_id: LEAVE_TYPE_ID,
        name: "Vacation / Unpaid 17d monthly",
        grant_mode: "periodic",
        grant_minutes: "8160",
        periodic_cadence: "monthly",
        periodic_minutes: "680",
        accrual_stop_minutes: "8160",
        take_ceiling_minutes: "8160",
        carryover_max_minutes: "2400",
        allow_forfeit: "false",
        negative_allowed: "true",
        negative_floor_minutes: "-240",
        approval_for_request: "admin",
        approval_for_log: "none",
        effective_from: "2026-01-01",
        tenure_min_years: ["0", "5"],
        tenure_max_years: ["4", ""],
        tenure_grant_minutes: ["8160", "9600"],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.accrual_stop_minutes).toBe(8160);
    expect(parsed.value.take_ceiling_minutes).toBe(8160);
    expect(parsed.value.carryover_max_minutes).toBe(2400);
    expect(parsed.value.negative_allowed).toBe(true);
    expect(parsed.value.tenure_bands).toEqual([
      { min_years: 0, max_years: 4, grant_minutes: 8160 },
      { min_years: 5, max_years: null, grant_minutes: 9600 },
    ]);
  });

  it("saves from the advanced JSON field when mode=json", () => {
    const parsed = policyInputFromFormData(
      form({
        mode: "json",
        json: JSON.stringify(validPolicy({ name: "From JSON" })),
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe("From JSON");
    }
  });
});

describe("parseAssignmentInput", () => {
  it("requires employee_id and policy_id", () => {
    const parsed = parseAssignmentInput({
      valid_from: "2026-01-01",
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects calendar-invalid dates", () => {
    const ids = {
      employee_id: "22222222-2222-4222-8222-222222222222",
      policy_id: "33333333-3333-4333-8333-333333333333",
    };
    expect(parseAssignmentInput({ ...ids, valid_from: "2026-02-31" }).ok).toBe(false);
    expect(parseAssignmentInput({ ...ids, valid_from: "2026-13-40" }).ok).toBe(false);
  });
});

describe("parsePolicyInput dates and minutes", () => {
  it("rejects calendar-invalid effective dates", () => {
    expect(parsePolicyInput(validPolicy({ effective_from: "2026-02-31" })).ok).toBe(false);
    expect(parsePolicyInput(validPolicy({ effective_from: "2026-13-40" })).ok).toBe(false);
    expect(parsePolicyInput(validPolicy({ effective_to: "2026-02-31" })).ok).toBe(false);
  });

  it("rejects negative grant/ceiling/band minutes", () => {
    expect(parsePolicyInput(validPolicy({ grant_minutes: -8160 })).ok).toBe(false);
    expect(parsePolicyInput(validPolicy({ take_ceiling_minutes: -1 })).ok).toBe(false);
    expect(
      parsePolicyInput(
        validPolicy({ tenure_bands: [{ min_years: 0, max_years: null, grant_minutes: -60 }] }),
      ).ok,
    ).toBe(false);
  });

  it("allows a negative floor when negative_allowed is true", () => {
    const parsed = parsePolicyInput(
      validPolicy({ negative_allowed: true, negative_floor_minutes: -240 }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.negative_allowed).toBe(true);
      expect(parsed.value.negative_floor_minutes).toBe(-240);
    }
  });
});

function memoryPersist(): PolicyPersistence {
  const leaveTypes = new Set<string>([LEAVE_TYPE_ID]);
  const employees = new Set<string>(["22222222-2222-4222-8222-222222222222"]);
  const policies = new Map<string, PolicyRecord>();
  const assignments = new Map<string, AssignmentRecord>();

  function toRecord(orgId: string, id: string, input: PolicySaveInput): PolicyRecord {
    return {
      id,
      orgId,
      leaveTypeId: input.leave_type_id,
      name: input.name,
      period: input.period,
      grantMode: input.grant_mode,
      grantMinutes: input.grant_minutes ?? null,
      periodicCadence: input.periodic_cadence ?? null,
      periodicMinutes: input.periodic_minutes ?? null,
      accrualStopMinutes: input.accrual_stop_minutes ?? null,
      takeCeilingMinutes: input.take_ceiling_minutes ?? null,
      carryoverMaxMinutes: input.carryover_max_minutes ?? null,
      allowForfeit: input.allow_forfeit,
      negativeAllowed: input.negative_allowed,
      negativeFloorMinutes: input.negative_floor_minutes ?? null,
      waitingPeriodDays: input.waiting_period_days,
      approvalForRequest: input.approval_for_request,
      approvalForLog: input.approval_for_log,
      noticeDays: input.notice_days ?? null,
      minIncrementMinutes: input.min_increment_minutes,
      effectiveFrom: input.effective_from,
      effectiveTo: input.effective_to ?? null,
      tenureBands: input.tenure_bands.map((band) => ({
        minYears: band.min_years,
        maxYears: band.max_years ?? null,
        grantMinutes: band.grant_minutes,
      })),
    };
  }

  return {
    async leaveTypeInOrg(_orgId, leaveTypeId) {
      return leaveTypes.has(leaveTypeId);
    },
    async insertPolicy(orgId, input) {
      const record = toRecord(orgId, crypto.randomUUID(), input);
      policies.set(record.id, record);
      return record;
    },
    async getPolicy(_orgId, id) {
      return policies.get(id) ?? null;
    },
    async updatePolicyRow(orgId, id, input) {
      const record = toRecord(orgId, id, input);
      policies.set(id, record);
      return record;
    },
    async getPolicyRef(_orgId, policyId) {
      const row = policies.get(policyId);
      return row ? { id: row.id, leaveTypeId: row.leaveTypeId } : null;
    },
    async employeeInOrg(_orgId, employeeId) {
      return employees.has(employeeId);
    },
    async upsertAssignment(row) {
      const key = `${row.employeeId}:${row.leaveTypeId}`;
      const existing = assignments.get(key);
      if (existing) {
        const updated = { ...existing, ...row };
        assignments.set(key, updated);
        return { assignment: updated, updatedInPlace: true };
      }
      const created = { id: crypto.randomUUID(), ...row };
      assignments.set(key, created);
      return { assignment: created, updatedInPlace: false };
    },
  };
}

const silentAudit = async () => {};

function mustParsePolicy(raw: Record<string, unknown>): PolicySaveInput {
  const parsed = parsePolicyInput(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("policy writers", () => {
  it("persists omitted allow_forfeit as false", async () => {
    const persist = memoryPersist();
    const created = await createPolicy(
      "org-1",
      mustParsePolicy(validPolicy()),
      "admin",
      silentAudit,
      persist,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.policy.allowForfeit).toBe(false);
    }
  });

  it("rejects changing leave_type_id on update", async () => {
    const persist = memoryPersist();
    const created = await createPolicy(
      "org-1",
      mustParsePolicy(validPolicy()),
      "admin",
      silentAudit,
      persist,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updatePolicy(
      "org-1",
      created.policy.id,
      mustParsePolicy(validPolicy({ leave_type_id: "44444444-4444-4444-8444-444444444444" })),
      "admin",
      silentAudit,
      persist,
    );
    expect(updated).toEqual({
      ok: false,
      status: 400,
      error: "cannot change leave_type_id (one type per policy)",
    });
  });

  it("assigns vacation B over A in place (same employee+type)", async () => {
    const persist = memoryPersist();
    const first = await createPolicy(
      "org-1",
      mustParsePolicy(validPolicy({ name: "Vacation A" })),
      "admin",
      silentAudit,
      persist,
    );
    const second = await createPolicy(
      "org-1",
      mustParsePolicy(validPolicy({ name: "Vacation B" })),
      "admin",
      silentAudit,
      persist,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const employeeId = "22222222-2222-4222-8222-222222222222";
    const assignedA = await assignPolicy(
      "org-1",
      {
        employee_id: employeeId,
        policy_id: first.policy.id,
        valid_from: "2026-01-01",
      },
      "admin",
      silentAudit,
      persist,
    );
    expect(assignedA.ok).toBe(true);
    if (!assignedA.ok) return;
    expect(assignedA.updatedInPlace).toBe(false);

    const assignedB = await assignPolicy(
      "org-1",
      {
        employee_id: employeeId,
        policy_id: second.policy.id,
        valid_from: "2026-06-01",
      },
      "admin",
      silentAudit,
      persist,
    );
    expect(assignedB.ok).toBe(true);
    if (!assignedB.ok) return;
    expect(assignedB.updatedInPlace).toBe(true);
    expect(assignedB.assignment.id).toBe(assignedA.assignment.id);
    expect(assignedB.assignment.policyId).toBe(second.policy.id);
    expect(assignedB.assignment.leaveTypeId).toBe(LEAVE_TYPE_ID);
  });
});
