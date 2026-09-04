import type { Balance } from "@/server/ledger/balance";

export const LEAVE_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const PORTIONS = ["full", "am", "pm", "custom"] as const;
export type Portion = (typeof PORTIONS)[number];

export const INTENTS = ["log", "request"] as const;
export type Intent = (typeof INTENTS)[number];

export const APPROVAL_MODES = ["none", "manager", "admin"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const CUTOVER_RULE_CODES = [
  "take_ceiling",
  "min_increment",
  "negative_balance",
  "holidays_excluded",
  "waiting_period",
  "overlap",
  "closed_period",
  "span_crosses_today",
] as const;

export const FOLLOW_ON_RULE_CODES = [
  "notice_period",
  "blackout",
  "max_concurrent",
  "max_consecutive",
  "accrual_stop",
] as const;

export type CutoverRuleCode = (typeof CUTOVER_RULE_CODES)[number];
export type FollowOnRuleCode = (typeof FOLLOW_ON_RULE_CODES)[number];
export type RuleCode = CutoverRuleCode | FollowOnRuleCode;

export type Evaluation =
  | { ok: true; minutes: number; postsLedger: boolean; newStatus: LeaveStatus }
  | { ok: false; code: RuleCode; message: string };

export type PolicyEmployee = {
  startDate: string;
  workdayMinutes?: number | null;
  role?: string;
};

export type ProposedLeave = {
  id?: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes?: number | null;
  intent?: Intent;
  consumesBalance?: boolean;
  unlimited?: boolean;
};

export type PolicyRuleRow = {
  code: string;
  enabled: boolean;
  params?: Record<string, unknown>;
};

export type PolicySnapshot = {
  takeCeilingMinutes?: number | null;
  minIncrementMinutes?: number | null;
  negativeAllowed?: boolean;
  negativeFloorMinutes?: number | null;
  waitingPeriodDays?: number;
  noticeDays?: number | null;
  noticeException?: "emergency" | "medical" | null;
  approvalForRequest?: ApprovalMode;
  approvalForLog?: ApprovalMode;
  consumesBalance?: boolean;
  unlimited?: boolean;
  weekendDays?: number[];
  workdayMinutes?: number;
  rules?: readonly PolicyRuleRow[];
};

export type HolidayDate = {
  onDate: string;
};

export type ExistingLeaveDay = {
  onDate: string;
  portion: Portion;
  consumesBalance?: boolean;
  slotActive?: boolean;
};

export type ExistingLeave = {
  id?: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  customMinutes?: number | null;
  consumesBalance: boolean;
  status?: LeaveStatus | string;
  slotActive?: boolean;
  days?: readonly ExistingLeaveDay[];
};

export type PeriodStatus = {
  year: number;
  status: string;
};

export type PolicyBalance = Pick<
  Balance,
  "takenMinutes" | "scheduledMinutes" | "requestedMinutes" | "availableMinutes"
>;

export type ExpandedDay = {
  onDate: string;
  minutes: number;
  portion: Portion;
};

export type EvaluateLeaveInput = {
  employee: PolicyEmployee;
  entry: ProposedLeave;
  policy: PolicySnapshot;
  balance: PolicyBalance;
  holidays: readonly HolidayDate[];
  existing: readonly ExistingLeave[];
  today: string;
  periodStatuses: readonly PeriodStatus[];
  /** Waiting-period only. Other Cutover rules still apply. */
  override?: boolean;
};
