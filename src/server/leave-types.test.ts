import { describe, expect, it } from "vitest";
import {
  leaveTypeDeleteBlocked,
  leaveTypeFromForm,
  parseLeaveTypeInput,
} from "./leave-types";

describe("leave type input", () => {
  it("accepts hours|days and optional increment/color", () => {
    expect(
      parseLeaveTypeInput({
        code: "wfh",
        name: "Work from home",
        consumesBalance: false,
        legalUnit: "hours",
        minIncrementMinutes: 30,
        color: "#abc",
      }),
    ).toEqual({
      ok: true,
      value: {
        code: "wfh",
        name: "Work from home",
        consumesBalance: false,
        legalUnit: "hours",
        minIncrementMinutes: 30,
        color: "#abc",
      },
    });
    expect(parseLeaveTypeInput({ code: "x", name: "X", legalUnit: "weeks" }).ok).toBe(false);
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
    expect(
      leaveTypeDeleteBlocked({
        leaveEntries: 0,
        policies: 0,
        ledgerEntries: 0,
        policyAssignments: 0,
      }),
    ).toBe(false);
  });
});
