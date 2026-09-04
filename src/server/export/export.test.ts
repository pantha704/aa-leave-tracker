import { describe, expect, it } from "vitest";
import { csvHeaderColumns } from "./csv";
import { balancesToCsv, buildExport, entriesToCsv, ledgerToCsv, type ExportSnapshot } from "./export";
import { parseExportKind } from "./kinds";
import { TERMINATION_HOUR_COLUMNS } from "./termination";

const snapshot: ExportSnapshot = {
  org: { timezone: "UTC", weekendDays: [6, 7] },
  employees: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "ada@example.com",
      name: "Ada Lovelace",
      startDate: "2026-01-01",
      endDate: null,
    },
  ],
  leaveTypes: [
    { id: "lt-vac", code: "pto", consumesBalance: true, unlimited: false },
    { id: "lt-wfh", code: "wfh", consumesBalance: false, unlimited: true },
  ],
  policies: [
    {
      employeeId: "11111111-1111-4111-8111-111111111111",
      leaveTypeId: "lt-vac",
      grantMode: "periodic",
      grantMinutes: null,
      validFrom: "2026-01-01",
      validTo: null,
    },
  ],
  holidays: [],
  ledger: [
    {
      employeeId: "11111111-1111-4111-8111-111111111111",
      leaveTypeId: "lt-vac",
      email: "ada@example.com",
      leaveTypeCode: "pto",
      kind: "accrual",
      minutes: 680,
      effectiveOn: "2026-01-01",
      periodYear: 2026,
      reason: null,
      reversedAt: null,
    },
  ],
  entries: [
    {
      employeeId: "11111111-1111-4111-8111-111111111111",
      email: "ada@example.com",
      leaveTypeCode: "pto",
      startDate: "2026-03-02",
      endDate: "2026-03-02",
      totalMinutes: 480,
      portion: "full",
      note: "need coverage, please",
      status: "approved",
      intent: "log",
    },
  ],
};

const store = {
  loadSnapshot: async () => snapshot,
};

describe("parseExportKind", () => {
  it("accepts kind and kind.csv", () => {
    expect(parseExportKind("balances.csv")).toBe("balances");
    expect(parseExportKind("Entries")).toBe("entries");
    expect(parseExportKind("ledger.csv")).toBe("ledger");
    expect(parseExportKind("termination.csv")).toBe("termination");
    expect(parseExportKind("payroll.csv")).toBeNull();
  });
});

describe("export CSV builders", () => {
  it("quotes notes that contain commas", () => {
    const csv = entriesToCsv(snapshot.entries);
    expect(csv).toContain('"need coverage, please"');
  });

  it("balances skip non-consuming types", () => {
    const csv = balancesToCsv(snapshot, snapshot.employees, "2026-06-15");
    expect(csv).toContain("pto");
    expect(csv).not.toContain("wfh");
    expect(csvHeaderColumns(csv)).toContain("remaining_hours");
  });

  it("balances asOf excludes later grants from granted and remaining", () => {
    const withJuly: ExportSnapshot = {
      ...snapshot,
      ledger: [
        ...snapshot.ledger,
        {
          ...snapshot.ledger[0],
          kind: "accrual",
          minutes: 680,
          effectiveOn: "2026-07-01",
        },
      ],
    };
    const june = balancesToCsv(withJuly, withJuly.employees, "2026-06-15");
    const july = balancesToCsv(withJuly, withJuly.employees, "2026-07-01");
    expect(june).toContain("11.33,0.00,0.00,0.00,11.33,11.33");
    expect(july).toContain("22.67,0.00,0.00,0.00,22.67,22.67");
  });

  it("prefixes a formula note so Excel will not execute it", () => {
    const csv = entriesToCsv([
      { ...snapshot.entries[0], note: '=HYPERLINK("http://evil.example","x")' },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(csv.split("\n")[1]).not.toMatch(/(^|,)=HYPERLINK/);
  });

  it("ledger includes minutes and hours", () => {
    const csv = ledgerToCsv(snapshot.ledger);
    expect(csv).toContain("accrual,680,11.33,2026-01-01,2026");
  });
});

describe("buildExport", () => {
  it("rejects an invalid date and a missing employee", async () => {
    await expect(
      buildExport({ orgId: "org", kind: "balances", asOf: "2026-02-31", store }),
    ).resolves.toEqual({ ok: false, status: 400, error: "invalid date" });
    await expect(
      buildExport({
        orgId: "org",
        kind: "entries",
        employeeId: "22222222-2222-4222-8222-222222222222",
        store,
      }),
    ).resolves.toEqual({ ok: false, status: 404, error: "employee not found" });
  });

  it("builds a termination CSV with both payout columns", async () => {
    const result = await buildExport({
      orgId: "org",
      kind: "termination",
      endDate: "2026-06-30",
      store,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const header = csvHeaderColumns(result.csv);
    expect(header).toEqual(expect.arrayContaining([...TERMINATION_HOUR_COLUMNS]));
    expect(result.filename).toBe("termination-2026-06-30.csv");
    expect(result.rowCount).toBe(1);
  });

  it("names a mixed-end-date termination file termination-mixed.csv", async () => {
    const mixed: ExportSnapshot = {
      ...snapshot,
      employees: [
        snapshot.employees[0],
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "bob@example.com",
          name: "Bob",
          startDate: "2026-01-01",
          endDate: "2026-03-15",
        },
      ],
    };
    const result = await buildExport({
      orgId: "org",
      kind: "termination",
      store: { loadSnapshot: async () => mixed },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("termination-mixed.csv");
  });
});
