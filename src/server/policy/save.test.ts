import { describe, expect, it } from "vitest";
import { parseAssignmentInput, parsePolicyInput, parsePolicyJson } from "./save";

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

describe("parseAssignmentInput", () => {
  it("requires employee_id and policy_id", () => {
    const parsed = parseAssignmentInput({
      valid_from: "2026-01-01",
    });
    expect(parsed.ok).toBe(false);
  });
});
