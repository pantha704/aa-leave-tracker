import { describe, expect, it } from "vitest";
import {
  canAdjustLedger,
  canAdmin,
  canApproveLeave,
  canCancelEntry,
  canCreateEmployee,
  canReadEmployee,
  canWriteEntry,
  type AuthzActor,
  type LeaveEntryAuthz,
  type PeriodGate,
} from "./authz";
import { ROLE_PERMISSIONS } from "./permissions";

const alice: AuthzActor = { id: "alice", role: "employee" };
const bob: AuthzActor = { id: "bob", role: "employee" };
const manager: AuthzActor = { id: "mgr", role: "manager" };
const admin: AuthzActor = { id: "admin", role: "admin" };

function entry(overrides: Partial<LeaveEntryAuthz> = {}): LeaveEntryAuthz {
  return {
    employeeId: "alice",
    status: "draft",
    immutableAt: null,
    ...overrides,
  };
}

describe("canAdmin / canAdjustLedger", () => {
  it("is admin only", () => {
    expect(canAdmin(admin)).toBe(true);
    expect(canAdmin(alice)).toBe(false);
    expect(canAdmin(manager)).toBe(false);
    expect(canAdmin(null)).toBe(false);
    expect(canAdjustLedger(admin)).toBe(true);
    expect(canAdjustLedger(alice)).toBe(false);
    expect(canAdjustLedger(undefined)).toBe(false);
  });
});

describe("canCreateEmployee", () => {
  it("is admin only — employees cannot create employees", () => {
    expect(canCreateEmployee(admin)).toBe(true);
    expect(canCreateEmployee(alice)).toBe(false);
    expect(canCreateEmployee(manager)).toBe(false);
    expect(canCreateEmployee(null)).toBe(false);
  });
});

describe("canReadEmployee", () => {
  it("allows self and any admin, not another employee", () => {
    expect(canReadEmployee(alice, "alice")).toBe(true);
    expect(canReadEmployee(alice, "bob")).toBe(false);
    expect(canReadEmployee(admin, "bob")).toBe(true);
    expect(canReadEmployee(manager, "alice")).toBe(false);
    expect(canReadEmployee(null, "alice")).toBe(false);
  });

  it("lets a manager read a direct report only", () => {
    expect(canReadEmployee(manager, "alice", { managerId: "mgr" })).toBe(true);
    expect(canReadEmployee(manager, "alice", { managerId: "other" })).toBe(false);
    expect(canReadEmployee(manager, "alice")).toBe(false);
  });
});

describe("canWriteEntry", () => {
  it("lets the owner PATCH draft/pending only while immutable_at is null", () => {
    expect(canWriteEntry(alice, entry())).toBe(true);
    expect(canWriteEntry(alice, entry({ status: "pending" }))).toBe(true);
    expect(canWriteEntry(alice, entry({ status: "approved" }))).toBe(false);
    expect(canWriteEntry(alice, entry({ status: "rejected" }))).toBe(false);
    expect(canWriteEntry(alice, entry({ immutableAt: new Date() }))).toBe(false);
    expect(canWriteEntry(alice, entry({ immutableAt: "2026-01-01T00:00:00.000Z" }))).toBe(false);
  });

  it("forbids employee A from writing employee B", () => {
    expect(canWriteEntry(bob, entry())).toBe(false);
  });

  it("lets admin mutate draft/pending only; no in-place PATCH of approved", () => {
    expect(canWriteEntry(admin, entry())).toBe(true);
    expect(canWriteEntry(admin, entry({ status: "pending" }))).toBe(true);
    expect(canWriteEntry(admin, entry({ status: "approved" }))).toBe(false);
    expect(canWriteEntry(admin, entry({ status: "cancelled" }))).toBe(false);
    expect(canWriteEntry(admin, entry({ status: "pending", immutableAt: new Date() }))).toBe(
      false,
    );
  });

  it("denies anonymous", () => {
    expect(canWriteEntry(null, entry())).toBe(false);
  });

  it("manager may read a report but cannot PATCH their entry", () => {
    const report = entry({ managerId: "mgr" });
    expect(canReadEmployee(manager, report.employeeId, { managerId: report.managerId })).toBe(true);
    expect(canWriteEntry(manager, report)).toBe(false);
    expect(canWriteEntry(alice, report)).toBe(true);
    expect(canWriteEntry(admin, report)).toBe(true);
  });
});

const open: PeriodGate = { open: true, today: "2026-03-15" };

describe("canCancelEntry", () => {
  it("lets owner or admin cancel draft/pending", () => {
    expect(canCancelEntry(alice, entry(), open)).toBe(true);
    expect(canCancelEntry(alice, entry({ status: "pending" }), open)).toBe(true);
    expect(canCancelEntry(admin, entry({ status: "pending" }), open)).toBe(true);
    expect(canCancelEntry(bob, entry(), open)).toBe(false);
    expect(canCancelEntry(null, entry(), open)).toBe(false);
  });

  it("lets owner cancel approved only when mutable, period open, and start_date > today", () => {
    const future = entry({ status: "approved", startDate: "2026-07-01" });
    expect(canCancelEntry(alice, future, open)).toBe(true);
    expect(canCancelEntry(alice, future, { open: false, today: "2026-03-15" })).toBe(false);
    expect(canCancelEntry(alice, { ...future, startDate: "2026-03-15" }, open)).toBe(false);
    expect(canCancelEntry(alice, { ...future, startDate: "2026-03-14" }, open)).toBe(false);
    expect(canCancelEntry(alice, { ...future, immutableAt: new Date() }, open)).toBe(false);
    expect(canWriteEntry(alice, future)).toBe(false);
  });

  it("lets admin cancel approved mutable rows in an open period, not via PATCH", () => {
    const approved = entry({ status: "approved", startDate: "2026-01-01" });
    expect(canCancelEntry(admin, approved, open)).toBe(true);
    expect(canCancelEntry(admin, approved, { open: false, today: "2026-03-15" })).toBe(false);
    expect(canCancelEntry(admin, { ...approved, immutableAt: new Date() }, open)).toBe(false);
    expect(canWriteEntry(admin, approved)).toBe(false);
  });

  it("manager may read a report but cannot cancel unless they own it", () => {
    const report = entry({ managerId: "mgr", status: "pending" });
    expect(canReadEmployee(manager, report.employeeId, { managerId: "mgr" })).toBe(true);
    expect(canCancelEntry(manager, report, open)).toBe(false);
  });
});

function member(
  id: string,
  organizationId: string,
  role: keyof typeof ROLE_PERMISSIONS,
): AuthzActor {
  return { id, organizationId, permissions: ROLE_PERMISSIONS[role] };
}

describe("multi-org membership authorization", () => {
  const prestonA = member("preston-a", "org-a", "org_admin");
  const prestonB = member("preston-b", "org-b", "employee");
  const managerA = member("mgr-a", "org-a", "manager");
  const report = {
    employeeId: "report-a",
    organizationId: "org-a",
    managerId: "mgr-a",
    status: "pending",
    immutableAt: null,
  };

  it("allows the same identity admin capabilities in A and denies them in B", () => {
    expect(canAdmin(prestonA)).toBe(true);
    expect(canCreateEmployee(prestonA)).toBe(true);
    expect(canAdjustLedger(prestonA)).toBe(true);
    expect(canReadEmployee(prestonA, "anyone-a", { organizationId: "org-a" })).toBe(true);

    expect(canAdmin(prestonB)).toBe(false);
    expect(canCreateEmployee(prestonB)).toBe(false);
    expect(canAdjustLedger(prestonB)).toBe(false);
    expect(canReadEmployee(prestonB, "anyone-b", { organizationId: "org-b" })).toBe(false);
    expect(canReadEmployee(prestonB, "preston-b", { organizationId: "org-b" })).toBe(true);
  });

  it("denies cross-org reads and mutations even when ids are guessed", () => {
    expect(canReadEmployee(prestonA, "org-b-employee", { organizationId: "org-b" })).toBe(false);
    expect(canReadEmployee(prestonB, "org-a-employee", { organizationId: "org-a" })).toBe(false);
    expect(
      canWriteEntry(prestonA, {
        ...report,
        employeeId: "org-b-employee",
        organizationId: "org-b",
      }),
    ).toBe(false);
    expect(canApproveLeave(prestonA, { ...report, organizationId: "org-b" })).toBe(false);
    expect(canApproveLeave(managerA, { ...report, organizationId: "org-b" })).toBe(false);
  });

  it("lets a manager act only on current direct reports in that org", () => {
    expect(canReadEmployee(managerA, "report-a", { organizationId: "org-a", managerId: "mgr-a" })).toBe(
      true,
    );
    expect(canApproveLeave(managerA, report)).toBe(true);
    expect(
      canReadEmployee(managerA, "other-team", { organizationId: "org-a", managerId: "other-mgr" }),
    ).toBe(false);
    expect(canApproveLeave(managerA, { ...report, employeeId: "other-team", managerId: "other-mgr" })).toBe(
      false,
    );
  });

  it("never allows self-approval even with approve capability", () => {
    const selfPending = {
      employeeId: "mgr-a",
      organizationId: "org-a",
      managerId: "boss",
      status: "pending",
      immutableAt: null,
    };
    expect(canApproveLeave(managerA, selfPending)).toBe(false);
    expect(canApproveLeave(prestonA, { ...selfPending, employeeId: "preston-a" })).toBe(false);
    const hrSelf = member("hr-1", "org-a", "hr");
    expect(canApproveLeave(hrSelf, { employeeId: "hr-1", organizationId: "org-a" })).toBe(false);
    expect(canApproveLeave(hrSelf, { employeeId: "someone-else", organizationId: "org-a" })).toBe(
      true,
    );
  });

  it("denies a privileged actor from another org", () => {
    const hrOther = member("hr-b", "org-b", "hr");
    expect(canApproveLeave(hrOther, report)).toBe(false);
    expect(canReadEmployee(hrOther, "report-a", { organizationId: "org-a" })).toBe(false);
    expect(canAdjustLedger(hrOther)).toBe(false);
  });
});
