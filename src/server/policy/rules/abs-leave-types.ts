import { inclusiveCalendarDays } from "@/server/leave/workflow";
import type { Evaluation } from "../types";

/** PTO-008: >3 calendar weeks is not a standard PTO workflow. */
export function consecutivePtoLimit(input: {
  startDate: string;
  endDate: string;
  leaveTypeCode: string | undefined;
  override: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (input.leaveTypeCode && input.leaveTypeCode !== "pto") return null;
  if (input.override) return null;
  const days = inclusiveCalendarDays(input.startDate, input.endDate);
  if (days <= 21) return null;
  return {
    ok: false,
    code: "max_consecutive",
    message: "PTO longer than 3 calendar weeks requires an exceptional HR process.",
  };
}

/** PTO-009: sick spanning more than 2 consecutive workdays. */
export function sickDocumentationMayBeRequired(input: {
  leaveTypeCode: string | undefined;
  workdayCount: number;
}): boolean {
  return input.leaveTypeCode === "sick" && input.workdayCount > 2;
}

/** PTO-010: LWOP only after PTO is exhausted, with a recorded qualifying condition. */
export function lwopEligibility(input: {
  leaveTypeCode: string | undefined;
  ptoAvailableMinutes: number | undefined;
  qualifyingCondition: string | null | undefined;
  override: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (input.leaveTypeCode !== "lwop") return null;
  if (input.override) return null;
  if (!String(input.qualifyingCondition ?? "").trim()) {
    return {
      ok: false,
      code: "lwop_eligibility",
      message: "LWOP requires a qualifying condition.",
    };
  }
  if ((input.ptoAvailableMinutes ?? 0) > 0) {
    return {
      ok: false,
      code: "lwop_eligibility",
      message: "LWOP is available only after accrued PTO is exhausted.",
    };
  }
  return null;
}
