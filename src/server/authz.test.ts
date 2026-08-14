import { describe, expect, it } from "vitest";
import {
  canAdjustLedger,
  canAdmin,
  canReadEmployee,
  canWriteEntry,
  type AuthzActor,
  type LeaveEntryAuthz,
} from "./authz";

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

describe("canReadEmployee", () => {
  it("allows self and any admin, not another employee", () => {
    expect(canReadEmployee(alice, "alice")).toBe(true);
    expect(canReadEmployee(alice, "bob")).toBe(false);
    expect(canReadEmployee(admin, "bob")).toBe(true);
    expect(canReadEmployee(manager, "alice")).toBe(false);
    expect(canReadEmployee(null, "alice")).toBe(false);
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
});
