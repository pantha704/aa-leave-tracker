import { describe, expect, it } from "vitest";
import { collectExistingHolidayConflicts, importHolidayCsv, type HolidayApplyResult } from "./import";

const noopAudit = async () => {};

describe("holiday import uniqueness", () => {
  it("flags CSV rows that already exist for (org, date, region)", () => {
    const errors = collectExistingHolidayConflicts(
      [
        { line: 2, onDate: "2026-01-01", name: "New Year", region: null },
        { line: 3, onDate: "2026-12-25", name: "Christmas", region: "US" },
      ],
      [{ onDate: "2026-01-01", region: null }],
    );
    expect(errors).toEqual([{ line: 2, message: "duplicate (org, date, region)" }]);
  });

  it("does not apply when parse errors exist", async () => {
    let applied = 0;
    const result = await importHolidayCsv(
      "org-1",
      ["date,name", "2026-01-01,A", "bad,B"].join("\n"),
      {
        apply: async () => {
          applied += 1;
          return { ok: true, imported: 0, updated: 0, holidays: [] };
        },
      },
      { writeAudit: noopAudit },
    );
    expect(applied).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCsv).toContain("invalid date: bad");
    }
  });

  it("inserts when the file is unique against existing rows", async () => {
    const result = await importHolidayCsv(
      "org-1",
      ["date,name,region", "2026-01-01,New Year,"].join("\n"),
      {
        apply: async (orgId, rows, mode) => {
          expect(orgId).toBe("org-1");
          expect(mode).toBe("insert");
          return {
            ok: true,
            imported: rows.length,
            updated: 0,
            holidays: rows.map((row, i) => ({
              id: `h-${i}`,
              onDate: row.onDate,
              name: row.name,
              region: row.region,
            })),
          };
        },
      },
      { writeAudit: noopAudit },
    );
    expect(result).toMatchObject({ ok: true, imported: 1, updated: 0 });
  });

  it("maps unique-violation from apply to an error list, not a throw", async () => {
    const result = await importHolidayCsv(
      "org-1",
      ["date,name", "2026-01-01,A"].join("\n"),
      {
        apply: async () => {
          const err = new Error("duplicate key") as Error & { code: string };
          err.code = "23505";
          throw err;
        },
      },
      { writeAudit: noopAudit },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ line: 2, message: "duplicate (org, date, region)" }]);
      expect(result.errorCsv).toContain("duplicate (org, date, region)");
    }
  });

  it("upserts names for existing (org, date, region) keys", async () => {
    const existing = [{ id: "h1", onDate: "2026-01-01", name: "Typo", region: null }];
    const result = await importHolidayCsv(
      "org-1",
      ["date,name", "2026-01-01,New Year"].join("\n"),
      {
        apply: async (_orgId, rows, mode) => {
          expect(mode).toBe("upsert");
          const conflicts = collectExistingHolidayConflicts(rows, existing);
          expect(conflicts).toHaveLength(1);
          return {
            ok: true,
            imported: 0,
            updated: 1,
            holidays: [{ id: "h1", onDate: "2026-01-01", name: "New Year", region: null }],
          } satisfies HolidayApplyResult;
        },
      },
      { mode: "upsert", writeAudit: noopAudit },
    );
    expect(result).toMatchObject({ ok: true, imported: 0, updated: 1 });
  });
});
