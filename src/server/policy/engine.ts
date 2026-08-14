import { DEMO_MIN_INCREMENT_MINUTES } from "@/db/demo-policy";
import { requireIsoDate } from "@/server/ledger/balance";
import { DEFAULT_WEEKEND_DAYS, expandProposedDays, resolveWorkdayMinutes } from "./days";
import { closedPeriod } from "./rules/closed-period";
import { minIncrement } from "./rules/min-increment";
import { negativeBalance } from "./rules/negative-balance";
import { overlap } from "./rules/overlap";
import { spanCrossesToday } from "./rules/span-crosses-today";
import { takeCeiling } from "./rules/take-ceiling";
import { waitingPeriod } from "./rules/waiting-period";
import { type Evaluation, type EvaluateLeaveInput, type Intent, type LeaveStatus } from "./types";

export type {
  Evaluation,
  EvaluateLeaveInput,
  RuleCode,
  LeaveStatus,
  ProposedLeave,
  PolicySnapshot,
  PolicyEmployee,
  ExistingLeave,
  HolidayDate,
  PeriodStatus,
} from "./types";

export { expandLeaveDays, expandProposedDays } from "./days";

function inferIntent(endDate: string, today: string, explicit?: Intent): Intent {
  if (explicit) return explicit;
  return endDate <= today ? "log" : "request";
}

function success(input: EvaluateLeaveInput, minutes: number): Extract<Evaluation, { ok: true }> {
  const today = requireIsoDate(input.today, "today");
  const endDate = requireIsoDate(input.entry.endDate, "endDate");
  const intent = inferIntent(endDate, today, input.entry.intent);
  const approval =
    intent === "log"
      ? (input.policy.approvalForLog ?? "none")
      : (input.policy.approvalForRequest ?? "admin");
  const consumesBalance = input.entry.consumesBalance ?? input.policy.consumesBalance ?? true;
  const newStatus: LeaveStatus = approval === "none" ? "approved" : "pending";
  return {
    ok: true,
    minutes,
    postsLedger: newStatus === "approved" && consumesBalance,
    newStatus,
  };
}

export function evaluateLeave(input: EvaluateLeaveInput): Evaluation {
  const startDate = requireIsoDate(input.entry.startDate, "startDate");
  const endDate = requireIsoDate(input.entry.endDate, "endDate");
  const today = requireIsoDate(input.today, "today");

  const span = spanCrossesToday({ startDate, endDate, today });
  if (span) return span;

  const consumesBalance = input.entry.consumesBalance ?? input.policy.consumesBalance ?? true;
  const unlimited = input.entry.unlimited ?? input.policy.unlimited ?? false;
  const weekendDays = input.policy.weekendDays ?? [...DEFAULT_WEEKEND_DAYS];
  const workdayMinutes = resolveWorkdayMinutes({
    employeeMinutes: input.employee.workdayMinutes,
    policyMinutes: input.policy.workdayMinutes,
  });

  const wait = waitingPeriod({
    startDate,
    hireDate: input.employee.startDate,
    waitingPeriodDays: input.policy.waitingPeriodDays ?? 0,
    consumesBalance,
    override: input.override === true,
  });
  if (wait) return wait;

  const days = expandProposedDays(input.entry, {
    consumesBalance,
    holidays: input.holidays,
    weekendDays,
    workdayMinutes,
  });
  const minutes = days.reduce((sum, day) => sum + day.minutes, 0);

  const closed = closedPeriod({ days, periodStatuses: input.periodStatuses });
  if (closed) return closed;

  const clash = overlap({
    days,
    consumesBalance,
    existing: input.existing,
    entryId: input.entry.id,
    holidays: input.holidays,
    weekendDays,
    workdayMinutes,
  });
  if (clash) return clash;

  const increment = minIncrement({
    days,
    incrementMinutes: input.policy.minIncrementMinutes ?? DEMO_MIN_INCREMENT_MINUTES,
  });
  if (increment) return increment;

  const ceiling = takeCeiling({
    balance: input.balance,
    thisMinutes: minutes,
    takeCeilingMinutes: input.policy.takeCeilingMinutes,
    consumesBalance,
    unlimited,
  });
  if (ceiling) return ceiling;

  const negative = negativeBalance({
    balance: input.balance,
    thisMinutes: minutes,
    negativeAllowed: input.policy.negativeAllowed ?? false,
    negativeFloorMinutes: input.policy.negativeFloorMinutes,
    consumesBalance,
    unlimited,
  });
  if (negative) return negative;

  return success(input, minutes);
}
