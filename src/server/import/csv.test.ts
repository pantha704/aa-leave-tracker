import { describe, expect, it } from "vitest";
import {
  GRANT_MAP_TARGETS,
  grantMapTargets,
  hoursToMinutes,
  importErrorsToCsv,
  mapImportCsv,
  remainingFromOpening,
  resolveMappedIndex,
  suggestImportMap,
  validateColumnMap,
} from "./csv";

const OPENING_HEADERS = ["Work Email", "PTO Bank", "As Of", "Left Hours", "Granted Hrs", "Used Hrs"];
const OPENING_CSV = [
  "Work Email,PTO Bank,As Of,Left Hours,Granted Hrs,Used Hrs",
  "ada@example.com,Vacation / Unpaid,2026-03-01,40.00,80.00,40.00",
].join("\n");

describe("CSV column map", () => {
  it("does not assume sheet headers; required fields must be mapped", () => {
    const unmapped = validateColumnMap(OPENING_HEADERS, {}, "opening");
    expect(unmapped.map((row) => row.field)).toEqual(["email", "leave_type", "as_of"]);
    expect(unmapped[0]?.message).toMatch(/headers are not assumed/);

    const parsed = mapImportCsv(OPENING_CSV, "opening", {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((row) => row.code === "UNMAPPED")).toBe(true);
    }
  });

  it("maps by explicit header name and by column index", () => {
    expect(resolveMappedIndex(OPENING_HEADERS, "Work Email")).toBe(0);
    expect(resolveMappedIndex(OPENING_HEADERS, "work_email")).toBe(0);
    expect(resolveMappedIndex(OPENING_HEADERS, 3)).toBe(3);
    expect(resolveMappedIndex(OPENING_HEADERS, "9")).toBeNull();

    const mapped = mapImportCsv(OPENING_CSV, "opening", {
      email: "Work Email",
      leave_type: "PTO Bank",
      as_of: "As Of",
      remaining_hours: "Left Hours",
    });
    expect(mapped.ok).toBe(true);
    if (mapped.ok && mapped.kind === "opening") {
      expect(mapped.rows).toEqual([
        {
          line: 2,
          email: "ada@example.com",
          leaveType: "Vacation / Unpaid",
          asOf: "2026-03-01",
          grantedHours: null,
          usedHours: null,
          remainingHours: 40,
          notes: null,
        },
      ]);
    }
  });

  it("suggests aliases only as hints; parse still needs the map", () => {
    const suggested = suggestImportMap(["Email", "Type", "Remaining"], "opening");
    expect(suggested.email).toBe("Email");
    expect(suggested.leave_type).toBe("Type");
    expect(suggested.remaining_hours).toBe("Remaining");
    expect(mapImportCsv("Email,Type,Remaining\na,b,1", "opening", {}).ok).toBe(false);
  });

  it("rejects mapping a grant target", () => {
    expect(GRANT_MAP_TARGETS.has("grant_lump")).toBe(true);
    expect(grantMapTargets({ grant_lump: "Allotment" })).toEqual(["grant_lump"]);
    const errors = validateColumnMap(OPENING_HEADERS, { grant: "Left Hours" }, "opening");
    expect(errors.some((row) => row.code === "GRANT_MAP")).toBe(true);
  });
});

describe("remainingFromOpening", () => {
  it("prefers granted minus used, then remaining-only with data-loss flag", () => {
    expect(remainingFromOpening({ grantedHours: 80, usedHours: 40, remainingHours: 40 })).toEqual({
      ok: true,
      minutes: hoursToMinutes(40),
      source: "granted_minus_used",
      dataLoss: false,
    });
    expect(remainingFromOpening({ grantedHours: 80, usedHours: 40, remainingHours: 99 }).ok).toBe(false);
    expect(remainingFromOpening({ grantedHours: null, usedHours: null, remainingHours: 12.5 })).toEqual({
      ok: true,
      minutes: 750,
      source: "remaining_only",
      dataLoss: true,
    });
    expect(remainingFromOpening({ grantedHours: 80, usedHours: null, remainingHours: null }).ok).toBe(
      false,
    );
  });

  it("does not treat granted_hours as a forbidden grant target", () => {
    expect(GRANT_MAP_TARGETS.has("granted")).toBe(false);
    expect(GRANT_MAP_TARGETS.has("grant_hours")).toBe(false);
    expect(grantMapTargets({ granted_hours: "Granted Hrs", used_hours: "Used Hrs" })).toEqual([]);
  });

  it("writes error CSV with line numbers", () => {
    expect(
      importErrorsToCsv([{ line: 2, field: "email", message: "unknown email: x" }]),
    ).toBe("line,field,message\n2,email,unknown email: x\n");
  });
});
