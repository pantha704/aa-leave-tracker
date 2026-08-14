import { addIsoDays, requireIsoDate } from "@/server/ledger/balance";
import type { Evaluation } from "../types";

export function waitingPeriod(input: {
  startDate: string;
  hireDate: string;
  waitingPeriodDays: number;
  consumesBalance: boolean;
  override: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (!input.consumesBalance || input.override) return null;
  const wait = input.waitingPeriodDays;
  if (!Number.isInteger(wait) || wait < 0) return null;
  const eligibleOn = addIsoDays(requireIsoDate(input.hireDate, "startDate"), wait);
  const start = requireIsoDate(input.startDate, "startDate");
  if (start < eligibleOn) {
    return {
      ok: false,
      code: "waiting_period",
      message: `Leave cannot start before the waiting period ends (${eligibleOn}).`,
    };
  }
  return null;
}
