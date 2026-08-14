import { describe, expect, it } from "vitest";
import {
  createLeaveType,
  deleteLeaveType,
  leaveTypeDeleteBlocked,
  leaveTypeFromForm,
  parseLeaveTypeInput,
  updateLeaveType,
  type LeaveTypeInput,
  type LeaveTypeRecord,
  type LeaveTypeStore,
  type LeaveTypeUsage,
} from "./leave-types";

const unused: LeaveTypeUsage = {
  leaveEntries: 0,
  policies: 0,
  ledgerEntries: 0,
  policyAssignments: 0,
};

const sample: LeaveTypeInput = {
  code: "wfh",
  name: "Work from home",
  consumesBalance: false,
  legalUnit: "hours",
  minIncrementMinutes: 30,
  color: "#abc",
  unlimited: false,
  visibleOnTeamCalendar: true,
};

function memoryStore(
  seed: LeaveTypeRecord[] = [],
  usage: Record<string, LeaveTypeUsage> = {},
): LeaveTypeStore {
  const rows = [...seed];
  return {
    async getById(orgId, id) {
      return rows.find((row) => row.orgId === orgId && row.id === id) ?? null;
    },
    async findIdByCode(orgId, code, excludeId) {
      return (
        rows.find(
          (row) =>
            row.orgId === orgId &&
            row.code.toLowerCase() === code.toLowerCase() &&
            row.id !== excludeId,
        )?.id ?? null
      );
    },
    async insert(orgId, input) {
      const created = { id: `lt-${rows.length + 1}`, orgId, ...input };
      rows.push(created);
      return created;
    },
    async update(orgId, id, input) {
      const idx = rows.findIndex((row) => row.orgId === orgId && row.id === id);
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...input };
      return rows[idx];
    },
    async remove(orgId, id) {
      const idx = rows.findIndex((row) => row.orgId === orgId && row.id === id);
      if (idx < 0) return false;
      rows.splice(idx, 1);
      return true;
    },
    async countUsage(id) {
      return usage[id] ?? unused;
    },
  };
}

describe("leave type input", () => {
  it("accepts hours|days and optional increment/color", () => {
    expect(
      parseLeaveTypeInput({
        code: "WFH",
        name: "Work from home",
        consumesBalance: false,
        legalUnit: "hours",
        minIncrementMinutes: 30,
        color: "#abc",
      }),
    ).toEqual({
      ok: true,
      value: sample,
    });
    expect(parseLeaveTypeInput({ code: "x", name: "X", legalUnit: "weeks" }).ok).toBe(false);
  });

  it("folds codes to lowercase for import-style uniqueness", () => {
    const a = parseLeaveTypeInput({
      code: "Sick",
      name: "Sick",
      consumesBalance: true,
      legalUnit: "days",
      minIncrementMinutes: null,
      color: null,
    });
    const b = parseLeaveTypeInput({
      code: "sick",
      name: "Sick",
      consumesBalance: true,
      legalUnit: "days",
      minIncrementMinutes: null,
      color: null,
    });
    expect(a.ok && b.ok && a.value.code === b.value.code).toBe(true);
    expect(a.ok && a.value.code).toBe("sick");
  });

  it("reads form fields including checkbox-style consumes_balance", () => {
    const form = new FormData();
    form.set("code", "sick");
    form.set("name", "Sick");
    form.set("consumesBalance", "true");
    form.set("legalUnit", "days");
    form.set("minIncrementMinutes", "");
    form.set("color", "");
    expect(parseLeaveTypeInput(leaveTypeFromForm(form))).toEqual({
      ok: true,
      value: {
        code: "sick",
        name: "Sick",
        consumesBalance: true,
        legalUnit: "days",
        minIncrementMinutes: null,
        color: null,
        unlimited: false,
        visibleOnTeamCalendar: true,
      },
    });
  });
});

describe("leave type delete protection", () => {
  it("blocks delete when leave entries exist", () => {
    expect(
      leaveTypeDeleteBlocked({
        leaveEntries: 1,
        policies: 0,
        ledgerEntries: 0,
        policyAssignments: 0,
      }),
    ).toBe(true);
  });

  it("blocks delete when a related FK row would fail even without entries", () => {
    expect(
      leaveTypeDeleteBlocked({
        leaveEntries: 0,
        policies: 1,
        ledgerEntries: 0,
        policyAssignments: 0,
      }),
    ).toBe(true);
    expect(
      leaveTypeDeleteBlocked({
        leaveEntries: 0,
        policies: 0,
        ledgerEntries: 1,
        policyAssignments: 0,
      }),
    ).toBe(true);
  });

  it("allows delete when unused", () => {
    expect(leaveTypeDeleteBlocked(unused)).toBe(false);
  });

  it("deleteLeaveType returns 409 when countLeaveTypeUsage is non-zero", async () => {
    const store = memoryStore(
      [{ id: "lt-1", orgId: "org-1", ...sample }],
      { "lt-1": { leaveEntries: 1, policies: 0, ledgerEntries: 0, policyAssignments: 0 } },
    );
    const result = await deleteLeaveType("org-1", "lt-1", { writeAudit: async () => {}, store });
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "cannot delete leave type that has entries or related records",
    });
    expect(await store.getById("org-1", "lt-1")).not.toBeNull();
  });

  it("deleteLeaveType removes an unused type", async () => {
    const store = memoryStore([{ id: "lt-1", orgId: "org-1", ...sample }]);
    const result = await deleteLeaveType("org-1", "lt-1", { writeAudit: async () => {}, store });
    expect(result).toEqual({ ok: true });
    expect(await store.getById("org-1", "lt-1")).toBeNull();
  });
});

describe("leave type identity lock and uniqueness", () => {
  it("refuses consumes_balance or legal_unit changes while in use", async () => {
    const store = memoryStore(
      [{ id: "lt-1", orgId: "org-1", ...sample }],
      { "lt-1": { leaveEntries: 0, policies: 1, ledgerEntries: 0, policyAssignments: 0 } },
    );
    const result = await updateLeaveType(
      "org-1",
      "lt-1",
      { ...sample, consumesBalance: true },
      { writeAudit: async () => {}, store },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: "cannot change consumes_balance or legal_unit while the type is in use",
    });
  });

  it("treats Sick and sick as the same code", async () => {
    const store = memoryStore([{ id: "lt-1", orgId: "org-1", ...sample, code: "sick" }]);
    const result = await createLeaveType(
      "org-1",
      { ...sample, code: "sick", name: "Sick 2" },
      { writeAudit: async () => {}, store },
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
  });
});
