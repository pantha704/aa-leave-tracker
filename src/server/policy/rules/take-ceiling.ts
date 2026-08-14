import type { Evaluation, PolicyBalance } from "../types";

export function takeCeiling(input: {
  balance: PolicyBalance;
  thisMinutes: number;
  takeCeilingMinutes: number | null | undefined;
  consumesBalance: boolean;
  unlimited: boolean;
}): Extract<Evaluation, { ok: false }> | null {
  if (!input.consumesBalance || input.unlimited) return null;
  const ceiling = input.takeCeilingMinutes;
  if (ceiling == null) return null;
  const used =
    input.balance.takenMinutes +
    input.balance.scheduledMinutes +
    input.balance.requestedMinutes +
    input.thisMinutes;
  if (used > ceiling) {
    return {
      ok: false,
      code: "take_ceiling",
      message: `This leave would exceed the take ceiling (${ceiling} min).`,
    };
  }
  return null;
}
