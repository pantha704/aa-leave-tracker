import { describe, expect, it } from "vitest";
import { DEMO_SICK_GRANT_MINUTES, DEMO_SICK_TYPE_CODE } from "@/db/demo-policy";
import { IMPORT_OPENING_REASON } from "./csv";
import { dryRunImport, type ImportWorld } from "./dry-run";

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VACATION = "11111111-1111-4111-8111-111111111111";
const SICK = "22222222-2222-4222-8222-222222222222";

function world(overrides: Partial<ImportWorld> = {}): ImportWorld {
  return {
    employees: [
      {
        id: ADA,
        email: "ada@example.com",
        name: "Ada",
        startDate: "2026-01-15",
        workdayMinutes: 480,
        orgWorkdayMinutes: 480,
        weekendDays: [6, 7],
      },
    ],
    leaveTypes: [
      { id: VACATION, code: "pto", name: "PTO", consumesBalance: true },
      { id: SICK, code: DEMO_SICK_TYPE_CODE, name: "Sick", consumesBalance: true },
    ],
    policies: [
      { leaveTypeId: VACATION, grantMode: "periodic", grantMinutes: null },
      { leaveTypeId: SICK, grantMode: "lump_sum", grantMinutes: DEMO_SICK_GRANT_MINUTES },
    ],
    ledger: [],
    holidays: [],
    occupancy: [],
    plannedFirstYearGrants: [],
    ...overrides,
  };
}

const openingMap = {
  email: "email",
  leave_type: "leave_type",
  as_of: "as_of",
  remaining_hours: "remaining_hours",
};

describe("dry-run opening remaining", () => {
  it("plans adjustment only, never grant_lump, including 0 remaining", () => {
    const csv = [
      "email,leave_type,as_of,remaining_hours",
      "ada@example.com,pto,2026-03-01,0",
    ].join("\n");
    const result = dryRunImport(csv, "opening", openingMap, world());
    expect(result.ok).toBe(true);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      kind: "adjustment",
      minutes: 0,
      effectiveOn: "2026-03-01",
      periodYear: 2026,
      reason: IMPORT_OPENING_REASON,
      employeeId: ADA,
      leaveTypeId: VACATION,
    });
    expect(result.posts.some((post) => (post.kind as string) === "grant_lump")).toBe(false);
  });

  it("rejects a header-only file", () => {
    const result = dryRunImport(
      "email,leave_type,as_of,remaining_hours\n",
      "opening",
      openingMap,
      world(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((row) => row.code === "EMPTY")).toBe(true);
  });

  it("hard-fails a mapped grant column", () => {
    const csv = ["email,leave_type,as_of,remaining_hours", "ada@example.com,sick,2026-01-01,24"].join(
      "\n",
    );
    const result = dryRunImport(
      csv,
      "opening",
      { ...openingMap, grant_lump: "remaining_hours" },
      world(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((row) => row.code === "GRANT_MAP")).toBe(true);
    expect(result.errorCsv).toContain("adjustment only");
  });

  it("hard-fails double-grant vs first-year open", () => {
    const csv = ["email,leave_type,as_of,remaining_hours", "ada@example.com,sick,2026-01-01,24"].join(
      "\n",
    );
    const alreadyGranted = world({
      ledger: [
        {
          employeeId: ADA,
          leaveTypeId: SICK,
          kind: "grant_lump",
          minutes: DEMO_SICK_GRANT_MINUTES,
          effectiveOn: "2026-01-01",
          periodYear: 2026,
          reversedAt: null,
        },
      ],
      plannedFirstYearGrants: [
        { employeeId: ADA, leaveTypeId: SICK, periodYear: 2026, kind: "grant_lump" },
      ],
    });
    const live = dryRunImport(csv, "opening", openingMap, alreadyGranted);
    expect(live.ok).toBe(false);
    expect(live.errors.some((row) => row.code === "DOUBLE_GRANT")).toBe(true);
    expect(live.errorCsv).toMatch(/double-grant vs first-year open/);

    const plannedOnly = world({
      plannedFirstYearGrants: [
        { employeeId: ADA, leaveTypeId: SICK, periodYear: 2026, kind: "grant_lump" },
      ],
    });
    const withoutSkip = dryRunImport(csv, "opening", openingMap, plannedOnly, {
      skipFirstYearOnImport: false,
    });
    expect(withoutSkip.ok).toBe(false);
    expect(withoutSkip.errors.some((row) => row.code === "DOUBLE_GRANT")).toBe(true);

    const withSkip = dryRunImport(csv, "opening", openingMap, plannedOnly, {
      skipFirstYearOnImport: true,
    });
    expect(withSkip.ok).toBe(true);
    expect(withSkip.posts[0]?.kind).toBe("adjustment");
    expect(withSkip.posts[0]?.reason).toBe(IMPORT_OPENING_REASON);
  });

  it("diffs app remaining vs the sheet remaining column", () => {
    const csv = [
      "email,leave_type,as_of,remaining_hours",
      "ada@example.com,pto,2026-03-01,10.00",
    ].join("\n");
    const result = dryRunImport(
      csv,
      "opening",
      openingMap,
      world({
        ledger: [
          {
            employeeId: ADA,
            leaveTypeId: VACATION,
            kind: "adjustment",
            minutes: 480,
            effectiveOn: "2026-01-01",
            periodYear: 2026,
            reversedAt: null,
            reason: "admin fix",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.posts[0]?.minutes).toBe(120);
    expect(result.diffs).toEqual([
      {
        line: 2,
        email: "ada@example.com",
        leaveType: "pto",
        asOf: "2026-03-01",
        sheetRemainingMinutes: 600,
        appRemainingMinutes: 480,
        deltaMinutes: 120,
      },
    ]);
  });
});

describe("dry-run historical entries", () => {
  it("plans approved + immutable historical entries and usage", () => {
    const csv = [
      "email,leave_type,start,end,hours,portion",
      "ada@example.com,pto,2026-03-02,2026-03-02,8.00,full",
    ].join("\n");
    const result = dryRunImport(
      csv,
      "entries",
      {
        email: "email",
        leave_type: "leave_type",
        start: "start",
        end: "end",
        hours: "hours",
        portion: "portion",
      },
      world(),
    );
    expect(result.ok).toBe(true);
    expect(result.entries[0]).toMatchObject({
      status: "approved",
      intent: "log",
      totalMinutes: 480,
    });
    expect(result.posts[0]?.kind).toBe("usage");
  });

  it("hard-fails occupancy overlap in dry-run, including in-file duplicates", () => {
    const csv = [
      "email,leave_type,start,end,hours,portion",
      "ada@example.com,pto,2026-03-02,2026-03-02,8.00,full",
      "ada@example.com,pto,2026-03-02,2026-03-02,4.00,am",
    ].join("\n");
    const map = {
      email: "email",
      leave_type: "leave_type",
      start: "start",
      end: "end",
      hours: "hours",
      portion: "portion",
    };
    const inFile = dryRunImport(csv, "entries", map, world());
    expect(inFile.ok).toBe(false);
    expect(inFile.errors.some((row) => row.code === "OVERLAP")).toBe(true);

    const existing = dryRunImport(
      [
        "email,leave_type,start,end,hours,portion",
        "ada@example.com,pto,2026-03-02,2026-03-02,8.00,full",
      ].join("\n"),
      "entries",
      map,
      world({
        occupancy: [
          {
            employeeId: ADA,
            onDate: "2026-03-02",
            portion: "am",
            consumesBalance: true,
            slotActive: true,
            status: "approved",
          },
        ],
      }),
    );
    expect(existing.ok).toBe(false);
    expect(existing.errors.some((row) => row.code === "OVERLAP")).toBe(true);
  });

  it("skips usage when an import opening already exists for that year", () => {
    const csv = [
      "email,leave_type,start,end,hours,portion",
      "ada@example.com,pto,2026-03-02,2026-03-02,8.00,full",
    ].join("\n");
    const result = dryRunImport(
      csv,
      "entries",
      {
        email: "email",
        leave_type: "leave_type",
        start: "start",
        end: "end",
        hours: "hours",
        portion: "portion",
      },
      world({
        ledger: [
          {
            employeeId: ADA,
            leaveTypeId: VACATION,
            kind: "adjustment",
            minutes: 480,
            effectiveOn: "2026-01-01",
            periodYear: 2026,
            reversedAt: null,
            reason: IMPORT_OPENING_REASON,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.posts).toEqual([]);
    expect(result.warnings.some((row) => row.code === "OPENING_PLUS_USAGE")).toBe(true);
  });

  it("unknown emails become error rows, not silent creates", () => {
    const csv = [
      "email,leave_type,as_of,remaining_hours",
      "missing@example.com,pto,2026-03-01,8",
    ].join("\n");
    const result = dryRunImport(csv, "opening", openingMap, world());
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/unknown email/);
    expect(result.posts).toEqual([]);
  });
});
