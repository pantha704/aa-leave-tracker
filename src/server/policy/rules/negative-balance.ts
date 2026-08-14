import type { Evaluation, PolicyBalance } from "../types";

export function negativeBalance(input: {
  balance: PolicyBalance;
  thisMinutes: number;
  negativeAllowed: boolean;
  negativeFloorMinutes: number | null | undefined;
  consumesBalance: boolean;
  unlimited: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (!input.consumesBalance || input.unlimited) return null;
  const projected = input.balance.availableMinutes - input.thisMinutes;
  const floor = input.negativeAllowed
    ? input.negativeFloorMinutes
    : Math.max(0, input.negativeFloorMinutes ?? 0);
  if (floor == null) return null;
  if (projected < floor) {
    return {
      ok: false,
      code: "negative_balance",
      message: `This leave would reduce available balance below ${floor} min.`,
    };
  }
  return null;
}
