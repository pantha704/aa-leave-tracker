import { describe, expect, it } from "vitest";
import { collectExistingHolidayConflicts, importHolidayCsv } from "./import";

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

  it("does not insert when parse or unique errors exist", async () => {
    let inserted = 0;
    const result = await importHolidayCsv(
      "org-1",
      ["date,name", "2026-01-01,A", "bad,B"].join("\n"),
      {
        loadExisting: async () => [],
        insertRows: async () => {
          inserted += 1;
          return [];
        },
      },
    );
    expect(inserted).toBe(0);
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
        loadExisting: async () => [{ onDate: "2026-12-25", region: null }],
        insertRows: async (orgId, rows) => {
          expect(orgId).toBe("org-1");
          return rows.map((row, i) => ({
            id: `h-${i}`,
            onDate: row.onDate,
            name: row.name,
            region: row.region,
          }));
        },
      },
    );
    expect(result).toMatchObject({ ok: true, imported: 1 });
  });
});
