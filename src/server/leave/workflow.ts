import { addIsoDays } from "@/lib/iso-date";
import { DEMO_LWOP_TYPE_CODE, DEMO_PTO_TYPE_CODE } from "@/db/demo-policy";
import { sameOrganization, type AuthzActor } from "@/server/authz";
import { hasPermission } from "@/server/permissions";

export type ApprovalStage = "manager" | "executive" | "hr";

export function inclusiveCalendarDays(startDate: string, endDate: string): number {
  let n = 0;
  for (let cursor = startDate; cursor <= endDate; cursor = addIsoDays(cursor, 1)) n += 1;
  return n;
}

/** PTO-008/010: manager; >2w and <=3w add executive; LWOP is manager then HR. */
export function requiredApprovalStages(input: {
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
}): ApprovalStage[] {
  if (input.leaveTypeCode === DEMO_LWOP_TYPE_CODE) return ["manager", "hr"];
  const days = inclusiveCalendarDays(input.startDate, input.endDate);
  if (days > 14 && days <= 21) return ["manager", "executive"];
  return ["manager"];
}

export function nextApprovalStage(
  stages: readonly ApprovalStage[],
  current: ApprovalStage | string | null | undefined,
): ApprovalStage | "done" {
  const now = current === "executive" || current === "hr" || current === "manager" ? current : stages[0];
  if (!now) return "done";
  const index = stages.indexOf(now);
  if (index < 0) return stages[0] ?? "done";
  return stages[index + 1] ?? "done";
}

export function canFulfillStage(
  actor: AuthzActor | null | undefined,
  stage: ApprovalStage,
  entry: { employeeId: string; organizationId?: string; managerId?: string | null },
): boolean {
  if (!actor) return false;
  if (actor.id === entry.employeeId) return false;
  if (!sameOrganization(actor, entry.organizationId)) return false;
  if (hasPermission(actor, "organization.manage")) return true;
  if (stage === "manager") {
    return (
      hasPermission(actor, "leave.approve.direct_reports") &&
      Boolean(entry.managerId) &&
      entry.managerId === actor.id
    );
  }
  if (stage === "executive") return hasPermission(actor, "leave.approve.executive");
  if (stage === "hr") return hasPermission(actor, "leave.approve.hr");
  return false;
}

export function defaultLeaveTypeCode(code: string | undefined): string {
  return code?.trim() || DEMO_PTO_TYPE_CODE;
}
