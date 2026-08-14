import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  DEMO_SICK_GRANT_MINUTES,
  DEMO_VACATION_GRANT_MINUTES,
  DEMO_VACATION_TAKE_CEILING_MINUTES,
  DEMO_WORKDAY_MINUTES,
} from "./demo-policy";
import { requireSeedTimezone } from "./seed";
import {
  auditEvents,
  blackoutDates,
  employees,
  holidays,
  importBatches,
  invites,
  leaveDays,
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
  policyRules,
  policyTenureBands,
  yearEndSnapshots,
} from "./schema";

const tables = {
  organizations,
  orgSettings,
  employees,
  invites,
  leaveTypes,
  policies,
  policyTenureBands,
  policyRules,
  policyAssignments,
  holidays,
  blackoutDates,
  importBatches,
  leaveEntries,
  leaveDays,
  ledgerEntries,
  policyPeriods,
  yearEndSnapshots,
  auditEvents,
};

describe("demo-policy DEMO constants", () => {
  it("exports integer DEMO minutes (8.00h workday, 17d vacation, 3d sick)", () => {
    expect(DEMO_WORKDAY_MINUTES).toBe(480);
    expect(DEMO_VACATION_GRANT_MINUTES).toBe(8160);
    expect(DEMO_VACATION_TAKE_CEILING_MINUTES).toBe(8160);
    expect(DEMO_SICK_GRANT_MINUTES).toBe(1440);
  });
});

describe("normative schema", () => {
  it("exports every Cutover table", () => {
    expect(Object.keys(tables).sort()).toEqual(
      [
        "auditEvents",
        "blackoutDates",
        "employees",
        "holidays",
        "importBatches",
        "invites",
        "leaveDays",
        "leaveEntries",
        "leaveTypes",
        "ledgerEntries",
        "orgSettings",
        "organizations",
        "policies",
        "policyAssignments",
        "policyPeriods",
        "policyRules",
        "policyTenureBands",
        "yearEndSnapshots",
      ].sort(),
    );
    for (const [name, table] of Object.entries(tables)) {
      expect(table, name).toBeDefined();
      expect(getTableConfig(table).name.length).toBeGreaterThan(0);
    }
  });

  it("never defines remaining as a column", () => {
    for (const [name, table] of Object.entries(tables)) {
      const cols = getTableColumns(table);
      expect(Object.keys(cols), name).not.toContain("remaining");
      expect(
        Object.values(cols).map((c) => c.name),
        name,
      ).not.toContain("remaining");
    }
  });

  it("uses named unique indexes from the design", () => {
    const assignmentIdx = getTableConfig(policyAssignments).indexes.map((i) => i.config.name);
    expect(assignmentIdx).toContain("policy_assignments_one");

    const holidayIdx = getTableConfig(holidays).indexes.map((i) => i.config.name);
    expect(holidayIdx).toContain("holidays_org_date_region");

    const leaveDayIdx = getTableConfig(leaveDays).indexes.map((i) => i.config.name);
    expect(leaveDayIdx).toContain("leave_days_consuming_portion");

    const ledgerIdx = getTableConfig(ledgerEntries).indexes.map((i) => i.config.name);
    expect(ledgerIdx).toContain("ledger_grant_once");
    expect(ledgerIdx).toContain("ledger_balance_idx");
  });

  it("requires IANA timezone from SEED_TIMEZONE with no default", () => {
    expect(() => requireSeedTimezone({})).toThrow(/SEED_TIMEZONE is required/);
    expect(() => requireSeedTimezone({ SEED_TIMEZONE: "   " })).toThrow(/SEED_TIMEZONE is required/);
    expect(requireSeedTimezone({ SEED_TIMEZONE: "UTC" })).toBe("UTC");
  });
});
