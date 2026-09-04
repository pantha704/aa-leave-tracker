import { inclusiveCalendarDays } from "@/server/leave/workflow";
import type { Evaluation } from "../types";

/** PTO-007: ordinary PTO blocked until employee-specific probation_end_date. */
export function probationRestriction(input: {
  startDate: string;
  today: string;
  leaveTypeCode: string | undefined;
  probationEndDate: string | null | undefined;
  override: boolean;
  noticeException?: "emergency" | "medical" | null;
  endDate: string;
}): Extract<Evaluation, { ok: false }> | null {
  if (input.leaveTypeCode && input.leaveTypeCode !== "pto") return null;
  const end = input.probationEndDate;
  if (!end) return null;
  if (input.startDate >= end) return null;
  if (input.override) return null;
  const days = inclusiveCalendarDays(input.startDate, input.endDate);
  if (input.noticeException === "emergency" && days <= 2) return null;
  return {
    ok: false,
    code: "probation",
    message: `Ordinary PTO is unavailable until probation ends (${end}).`,
  };
}

/** PTO-007: ordinary PTO blocked after notice-period start unless audited override. */
export function employmentNoticeRestriction(input: {
  startDate: string;
  leaveTypeCode: string | undefined;
  noticePeriodStartDate: string | null | undefined;
  override: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (input.leaveTypeCode && input.leaveTypeCode !== "pto") return null;
  const start = input.noticePeriodStartDate;
  if (!start) return null;
  if (input.startDate < start) return null;
  if (input.override) return null;
  return {
    ok: false,
    code: "employment_notice",
    message: `Ordinary PTO is unavailable after notice period start (${start}).`,
  };
}
