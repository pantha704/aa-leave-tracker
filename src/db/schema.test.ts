import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  DEMO_LWOP_TYPE_CODE,
  DEMO_PTO_CARRYOVER_MINUTES,
  DEMO_PTO_TYPE_CODE,
  DEMO_SICK_GRANT_MINUTES,
  DEMO_VACATION_GRANT_MINUTES,
  DEMO_VACATION_TAKE_CEILING_MINUTES,
  DEMO_VACATION_TYPE_CODE,
  DEMO_WORKDAY_MINUTES,
} from "./demo-policy";
import { readFileSync } from "node:fs";
import {
  normalizeSeedAdminEmail,
  requireSeedAdminPassword,
  requireSeedTimezone,
  resolveSeedAdmins,
} from "./seed";
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
import {
  membershipRoles,
  organizationMemberships,
  organizationRoles,
  reportingRelationships,
} from "./schema-membership";

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
  organizationRoles,
  organizationMemberships,
  membershipRoles,
  reportingRelationships,
};

describe("demo-policy DEMO constants", () => {
  it("exports integer DEMO minutes (8.00h workday, 17d vacation, 3d sick)", () => {
    expect(DEMO_WORKDAY_MINUTES).toBe(480);
    expect(DEMO_VACATION_GRANT_MINUTES).toBe(8160);
    expect(DEMO_VACATION_TAKE_CEILING_MINUTES).toBe(8160);
    expect(DEMO_SICK_GRANT_MINUTES).toBe(1440);
    expect(DEMO_PTO_CARRYOVER_MINUTES).toBe(4800);
    expect(DEMO_PTO_TYPE_CODE).toBe("pto");
    expect(DEMO_VACATION_TYPE_CODE).toBe("pto");
    expect(DEMO_LWOP_TYPE_CODE).toBe("lwop");
    expect(DEMO_VACATION_TYPE_CODE).not.toBe("vacation_unpaid");
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
        "organizationRoles",
        "organizationMemberships",
        "membershipRoles",
        "reportingRelationships",
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
    expect(ledgerIdx).toContain("ledger_import_opening_once");
    expect(ledgerIdx).toContain("ledger_balance_idx");
  });

  it("requires IANA timezone from SEED_TIMEZONE with no default", () => {
    expect(() => requireSeedTimezone({})).toThrow(/SEED_TIMEZONE is required/);
    expect(() => requireSeedTimezone({ SEED_TIMEZONE: "   " })).toThrow(/SEED_TIMEZONE is required/);
    expect(requireSeedTimezone({ SEED_TIMEZONE: "UTC" })).toBe("UTC");
  });

  it("requires SEED_ADMIN_PASSWORD for the admin credential", () => {
    expect(() => requireSeedAdminPassword({})).toThrow(/SEED_ADMIN_PASSWORD is required/);
    expect(() => requireSeedAdminPassword({ SEED_ADMIN_PASSWORD: "" })).toThrow(
      /SEED_ADMIN_PASSWORD is required/,
    );
    expect(() => requireSeedAdminPassword({ SEED_ADMIN_PASSWORD: "ab" })).toThrow(
      /at least 6 characters/,
    );
    expect(requireSeedAdminPassword({ SEED_ADMIN_PASSWORD: "das@21" })).toBe("das@21");
  });

  it("stores seed admin email in lowercase", () => {
    expect(normalizeSeedAdminEmail("Admin@AbsoluteAddiction.local", "x@y.z")).toBe(
      "admin@absoluteaddiction.local",
    );
    expect(normalizeSeedAdminEmail("  a@b.C  ", "x@y.z")).toBe("a@b.c");
    expect(normalizeSeedAdminEmail(undefined, "Admin@X.local")).toBe("admin@x.local");
  });

  it("defaults seed admins to preston and das", () => {
    expect(resolveSeedAdmins({})).toEqual([
      { email: "preston@absoluteaddiction.com", name: "Preston" },
      { email: "das@absoluteaddiction.com", name: "Das" },
    ]);
    expect(
      resolveSeedAdmins({
        SEED_ADMIN_EMAILS: "Preston@AbsoluteAddiction.com, das@absoluteaddiction.com",
      }),
    ).toEqual([
      { email: "preston@absoluteaddiction.com", name: "Preston" },
      { email: "das@absoluteaddiction.com", name: "Das" },
    ]);
  });

  it("does not seed holiday rows", () => {
    const src = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/insert\(holidays\)/);
    expect(src).toMatch(/No holiday rows seeded/);
  });

  it("adds must_change_password and auth_user_id on employees", () => {
    const cols = getTableColumns(employees);
    expect(cols.mustChangePassword.name).toBe("must_change_password");
    expect(cols.authUserId.name).toBe("auth_user_id");
  });

  it("commits a membership migration that lifts global auth-user uniqueness", () => {
    const src = readFileSync(new URL("./migrations/0003_purple_jubilee.sql", import.meta.url), "utf8");
    expect(src).toMatch(/DROP INDEX "employees_auth_user_id_unique"/);
    expect(src).toMatch(/CREATE UNIQUE INDEX "employees_org_auth_user_unique"/);
    expect(src).toMatch(/INSERT INTO "organization_memberships"/);
    expect(src).toMatch(/INSERT INTO "reporting_relationships"/);
  });

  it("scopes auth user uniqueness per organization so one identity can join two orgs", () => {
    const empIdx = getTableConfig(employees).indexes.map((i) => i.config.name);
    expect(empIdx).toContain("employees_org_auth_user_unique");
    expect(empIdx).not.toContain("employees_auth_user_id_unique");
    const membershipIdx = getTableConfig(organizationMemberships).indexes.map((i) => i.config.name);
    expect(membershipIdx).toContain("organization_memberships_org_auth_user");
    expect(getTableColumns(organizations).slug.name).toBe("slug");
  });
});
