/** MAIL-001/002: request -> Manager+HR (+next step); decision -> Employee+HR. */

export type PendingNotifyRole = "manager" | "hr" | "executive";
export type DecisionNotifyRole = "employee" | "hr";

export function pendingNotifyRoles(nextStage?: string | null): PendingNotifyRole[] {
  if (nextStage === "executive") return ["manager", "hr", "executive"];
  return ["manager", "hr"];
}

export function decisionNotifyRoles(): DecisionNotifyRole[] {
  return ["employee", "hr"];
}
