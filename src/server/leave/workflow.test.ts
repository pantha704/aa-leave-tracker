import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/server/permissions";
import type { AuthzActor } from "@/server/authz";
import {
  canFulfillStage,
  inclusiveCalendarDays,
  nextApprovalStage,
  requiredApprovalStages,
} from "./workflow";

describe("requiredApprovalStages", () => {
  it("routes normal PTO to manager and extended PTO to manager then executive", () => {
    expect(
      requiredApprovalStages({ leaveTypeCode: "pto", startDate: "2026-07-06", endDate: "2026-07-10" }),
    ).toEqual(["manager"]);
    expect(
      requiredApprovalStages({ leaveTypeCode: "pto", startDate: "2026-07-06", endDate: "2026-07-22" }),
    ).toEqual(["manager", "executive"]);
  });

  it("routes LWOP through manager then HR", () => {
    expect(
      requiredApprovalStages({ leaveTypeCode: "lwop", startDate: "2026-07-06", endDate: "2026-07-07" }),
    ).toEqual(["manager", "hr"]);
  });
});

describe("canFulfillStage", () => {
  const report = { employeeId: "alice", organizationId: "org-a", managerId: "mgr" };
  const manager: AuthzActor = {
    id: "mgr",
    organizationId: "org-a",
    permissions: ROLE_PERMISSIONS.manager,
  };
  const exec: AuthzActor = {
    id: "exec",
    organizationId: "org-a",
    permissions: ROLE_PERMISSIONS.executive,
  };
  const hr: AuthzActor = {
    id: "hr",
    organizationId: "org-a",
    permissions: ROLE_PERMISSIONS.hr,
  };

  it("lets a manager complete the manager step but not HR/executive, and never self", () => {
    expect(canFulfillStage(manager, "manager", report)).toBe(true);
    expect(canFulfillStage(manager, "executive", report)).toBe(false);
    expect(canFulfillStage(exec, "executive", report)).toBe(true);
    expect(canFulfillStage(hr, "hr", report)).toBe(true);
    expect(canFulfillStage(hr, "hr", { ...report, employeeId: "hr" })).toBe(false);
    expect(inclusiveCalendarDays("2026-07-06", "2026-07-22")).toBe(17);
    expect(nextApprovalStage(["manager", "executive"], "manager")).toBe("executive");
    expect(nextApprovalStage(["manager", "executive"], "executive")).toBe("done");
  });
});
